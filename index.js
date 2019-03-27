const express = require('express');
const app = express();
const {UTG, Exchanges, ExchangeOperation, Order, Trade, Status} = require('utg');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const {Broker} = require('./src/broker');
const {DbOrder, DbTrade, OrderService} = require('./src/db');

const wss = new WebSocket.Server({ port: 8080 });

let client;
const isEmulator = process.argv[2] === "-emulator";
const connector = !isEmulator ? new UTG({
        poloniex: {
            secret: "",
            key: ""
        },
        bittrex: {
            secret: "",
            key: ""
        },
        binance: {
            secret: "",
            key: ""
        }
    }) :
    new UTG({
        poloniex: {
            secret: "",
            key: "emulator",
            balances: {"BTC": "20", "ETH": "500", "XRP": "100000", "WAVES": "100000"},
        },
        bittrex: {
            secret: "",
            key: "emulator",
            balances: {"BTC": "20", "ETH": "500", "XRP": "100000", "WAVES": "100000"},
        },
        binance: {
            secret: "",
            key: "emulator",
            balances: {"BTC": "20", "ETH": "500", "XRP": "100000", "WAVES": "100000"},
        }
    });


const ORION_SETTINGS = {
    orionUrl: 'http://127.0.0.1:9090',
    address: '', //Waves address
    callbackUrl: 'http://127.0.0.1:3000/api'
};

const broker = new Broker(ORION_SETTINGS);
broker.registerBoker();
broker.startUpdateBalances(connector);

connector.orderWatcher(orderChanged);

app.use(bodyParser.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.use(express.static('frontend/build'));

app.get('/api/openorders', async (req, res) => {
    const orders = await OrderService.getAllOrders();
    res.send(orders);
});

app.get('/api/orderhistory', async (req, res) => {
    const orders = await connector.getOpenOrders();

    let promises = [], opened = [];

    for (let exchange in orders) {
        if (orders[exchange].success) {
            for (let pair in orders[exchange].result) {
                orders[exchange].result[pair].forEach((order, i) => {
                    const dbOrder = {
                        exchange: order.exchange.id,
                        side: order.side,
                        pair: order.pair,
                        rate: parseFloat(order.rate),
                        amount: parseFloat(order.amount),
                        id: order.id,
                        time: order.time,
                        type: order.type,
                        status: order.status
                    };

                    opened.push(order.id);

                    promises.push(updateOrCreate(DbOrder, {id: order.id}, dbOrder));
                });
            }
        }
    }

    Promise.all(promises)
        .then(() => DbOrder.findAll({raw: true}))
        .then((orders) => {
            let promises = [];

            orders.forEach((order, i) => {
                if (order.id !== undefined && !opened.includes(order.id) && order.status !== "closed") {
                    promises.push(DbOrder.update({status: "closed"}, {where: {id: order.id}}));
                }
            });

            if (promises) {
                return Promise.all(promises);
            } else {
                parseReturningDate(orders).then((result) => res.send(result));
                throw new Error("There is nothing to update");
            }})
        .then(() => DbOrder.findAll({raw: true}))
        .then((orders) => {
            parseReturningDate(orders).then((result) => res.send(result))})
        .catch((error) => {
            console.log(error.message);
        });
});

app.post('/api/cancelorder', (req, res) => {
    const id = req.body['id'];
    let promise;

    if (id === undefined) {
        const submitId = req.body['submitId'];

        promise = DbOrder.findAll({where: {submitOrder_id: submitId}, raw: true});
    } else {
        promise = DbOrder.findOne({where: {id}, raw: true})
    }

    promise
        .then((orders) => {
            const body = Array.isArray(orders)?orders:[orders];
            return connector.cancelOrder(body)})
        .then((exchanges) => {
            let response = [], promises = [];

            for (let exchange in exchanges) {
                if (exchanges[exchange].success) {
                    const result = exchanges[exchange].result;
                    console.log(result.message);

                    promises.push(DbOrder.update({status: "closed"}, {where: {id: result.id}}));

                    response.push(result.id);
                } else {
                    response.push(exchanges[exchange]);
                }
            }
            res.send(response);

            return Promise.all(promises)})
        .then(() => {
            console.log("Update cancelled orders status")})
        .catch((error) => {
            console.log(error.message);
        })
});

app.post('/api/order', async (req, res) => {
    const side = req.body['side'],
        symbol = req.body['symbol'],
        exchange = req.body['exchange'],
        ordType = req.body['ordType'] ? req.body['ordType'] : "LIMIT",
        price = req.body['price'],
        subOrdQty = req.body['subOrdQty'],
        ordId = req.body['ordId'],
        subOrdId = req.body['subOrdId'];

    try {
        const order = await connector.createOrder(exchange, symbol, side, subOrdQty, price);
        /*const allOrders = await OrderService.getAllOrders();
        const maxOrdId = Number(allOrders.reduce((p, o) => (p > (Number(o.exchangeOrdId) || 0)) ? p : o.exchangeOrdId, 0)) || 0;
        const order = {
            exchange: exchange,
            exchangeOrdId: maxOrdId + 1,
            symbol: symbol,
            side: side,
            ordType: ordType,
            price: price,
            qty: subOrdQty,
            timestamp: new Date().getTime(),
            status: 'NEW'
        };*/
        let dbOrder = {
            exchange: order.exchange,
            exchangeOrdId: order.exchangeOrdId,
            ordId: ordId,
            subOrdId: subOrdId,
            symbol: order.symbol,
            side: order.side,
            ordType: order.ordType,
            price: order.price,
            ordQty: order.qty,
            timestamp: order.timestamp,
            status: order.status
        };

        dbOrder = await DbOrder.create(dbOrder);

        if (client)
            client.send(JSON.stringify(dbOrder));

        res.send(dbOrder);
    } catch (error) {
        console.log(error);
        res.status(400);
        res.send({code: 1000, msg: error.message});
    }


});

app.post('/api/trade', async (req, res) => {
    const ordId = req.body['ordId'],
        tradeId = req.body['tradeId'],
        price = req.body['price'],
        qty = req.body['qty'],
        status = req.body['status'],
        exchange = req.body['exchange'];

        const trade = new Trade(
            exchange,
            ordId,
            tradeId,
            price,
            qty,
            status,
            new Date().getTime(),
        );
        try {
            let order = await DbOrder.findOne(
                {where: {exchange: trade.exchange, exchangeOrdId: trade.exchangeOrdId}});

            if (!order) {
                throw new Error(`Order ${trade.exchangeOrdId} in ${trade.exchange} not found`);
            }

            let dbTrade = await DbTrade.create(trade);

            const resOrder = await broker.sendTrade(order, dbTrade);

            order.filledQty = Number(order.filledQty) + Number(dbTrade.qty);

            const tradeCost = dbTrade.price * dbTrade.qty;
            order.totalCost = (Number(order.totalCost) + tradeCost).toFixed(8);

            if (!dbTrade.status) {
                dbTrade.status = calculateTradeStatus(order.ordQty, order.filledQty)
            }
            order.status = dbTrade.status;

            dbTrade.setOrder(order);

            dbTrade = await dbTrade.save();
            order = await order.save();

            const fullOrder = await DbOrder.findByPk(order.id,
                {
                    include: [{model: DbTrade, as: 'fills'}],
                    order: [[{model: DbTrade, as: 'fills'}, 'timestamp', 'DESC'], ['timestamp', 'DESC']]
                });

            if (client) {
                client.send(JSON.stringify(fullOrder));
            }

            res.send(fullOrder)

        } catch (error) {
            console.log(error);
            res.status(400);
            res.send({code: 1000, msg: error.message});
        }
});

app.get('/api/order1', async (req, res) => {

    try {

        let order = await DbOrder.findByPk(1, { include: [{ model: DbTrade, as: 'fills' }] });
        //await order.getFills();
        res.send(order)
    } catch (error) {
        console.log(error);
        res.status(400);
        res.send({code: 1000, msg: error.message});
    }

});


app.listen(3000, function () {
    console.log('Example app listening on http://localhost:3000/');
});

wss.on('connection', ws => {
    console.log("Open webscoket");
    if (client !== undefined) {
        client = ws;
    }

    ws.on('message', message => {
        if (message === "orderwatcher" && client === undefined) {
            client = ws;
        }
    });
});


function calculateTradeStatus(ordQty, filledQty) {

    if (filledQty === 0) {
        return Status.NEW;
    } else if (filledQty < ordQty) {
        return Status.PARTIALLY_FILLED;
    } else {
        return Status.FILLED;
    }
}

function sleep(ms){
    return new Promise(resolve => {
        setTimeout(resolve,ms)
    })
}

/**
 *
 * @param trade: Trade
 * @returns {Promise<void>}
 */
async function orderChanged(trade) {
    try {
        let nRetries = 0;
        let order = null;
        while (nRetries < 3) {
            order = await DbOrder.findOne(
                {where: {exchange: trade.exchange, exchangeOrdId: trade.exchangeOrdId}});

            if (!order) {
                await sleep(1000);
                ++nRetries;
            } else  {
                break;
            }
        }

        if (!order) {
            throw new Error(`Order ${trade.exchangeOrdId} in ${trade.exchange} not found`);
        }

        let dbTrade = await DbTrade.create(trade);

        const resOrder = await broker.sendTrade(order, dbTrade);

        order.filledQty = Number(order.filledQty) + Number(dbTrade.qty);

        const tradeCost = dbTrade.price * dbTrade.qty;
        order.totalCost = (Number(order.totalCost) + tradeCost).toFixed(8);

        if (!dbTrade.status) {
            dbTrade.status = calculateTradeStatus(order.ordQty, order.filledQty)
        }
        order.status = dbTrade.status;

        dbTrade.setOrder(order);

        dbTrade = await dbTrade.save();
        order = await order.save();

        const fullOrder = await DbOrder.findByPk(order.id,
            {
                include: [{model: DbTrade, as: 'fills'}],
                order: [[{model: DbTrade, as: 'fills'}, 'timestamp', 'DESC'], ['timestamp', 'DESC']]
            });

        if (client) {
            client.send(JSON.stringify(fullOrder));
        }

    } catch (error) {
        console.log("Error during Trade callback", error);
    }
}

function updateOrCreate(model, where, item) {
    return model
        .findOne({where: where, raw: true})
        .then(exitem => {
            if (!exitem) {
                return model
                    .create(item, {raw: true})
                    .then((result) => {
                        return {item: result, created: true}})
                    .catch((error) => {
                        console.log(error);
                    })
            } else {
                return model
                    .update(item, {where: where})
                    .then((result) => {
                        return model.findOne({where: where})})
                    .then((result) => {
                        return {item: result, created: false}})
                    .catch((error) => {
                        console.log(error);
                    })
            }
        });
}

function parseReturningDate(orders /*Should be an array*/) {
    let parsedData = {errors: []};
    let unknown = 0;
    return DbSubmitOrder
        .findAll({raw: true})
        .then((sOrders) => {
            sOrders.forEach((order, i) => {
                parsedData[order.id] = {
                    pair: order.pair,
                    side: order.side,
                    amount: order.amount,
                    rate: order.rate,
                    exchanges: []
                };
            });

            orders.forEach((order, i) => {
                if (order.hasOwnProperty("submitOrder_id") &&
                    order.submitOrder_id !== null &&
                    parsedData.hasOwnProperty(order.submitOrder_id)) {
                    //Orion library orders
                    parsedData[order.submitOrder_id].exchanges.push(order);
                } else if (!order.hasOwnProperty("failure")){
                    //Unknown orders
                    parsedData["unknown-" + unknown] = order;
                    unknown++;
                } else {
                    //Error orders
                    parsedData[order.submitId].exchanges.push(order);
                }
            });


            let parseArrData = {orders: [], errors: parsedData.errors};

            for (let order in parsedData) {
                if (order !== "errors") {
                    parseArrData.orders.push(parsedData[order]);
                }
            }

            return parseArrData;
        });
}