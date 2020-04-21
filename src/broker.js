const { Observable, Subject, ReplaySubject, interval, from, of } = require('rxjs');
const { ajax } = require('rxjs/ajax');
const { map, filter, switchMap, catchError, repeat, flatMap, delay, tap } = require('rxjs/operators');
const {UTG, ExchangeOperation, Order, Trade} = require("orion-connectors");

class Broker {
    constructor(settings) {
        this.address = settings.address;
        this.orionUrl = settings.orionUrl + '/api/v1';
        this.callbackUrl = settings.callbackUrl;
        this.registered = false;
    };

    registerBoker() {
        const headers = new Headers({
            'Content-Type': 'application/json'
        });

        let body =  JSON.stringify({
            "address": this.address,
            "publicKey": this.address,
            "callbackUrl": this.callbackUrl,
            "signature": ""
        });

        fetch(`${this.orionUrl}/broker/register`, {method: 'POST', body, headers})
            .then((response) => {
                return response.json()
            })
            .then((result) => {
                if (result.status === 'REGISTERED') {
                    this.registered = true;
                    console.info('Broker has been registered with id: ', result.broker);
                } else {
                    console.info("Broker connected:", result);
                }
            })
            .catch((error) => {
                console.error('Error on broker/register: ', error.message);
            });

    }

    sendUpdateBalance(balances) {
        balances.address = this.address;

        const bodyToSend = JSON.stringify(balances, (k, v) => isNaN(v) ? v : v.toString());

        return (fetch(`${this.orionUrl}/broker/balance`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: bodyToSend
        }).then((r1) => {
            return r1.json()
        }).then((result) => {
            //console.info('Balance updated: ', bodyToSend);
        }).catch((error) => {
            console.error('Error on broker/register: ', error.message);
        }));
    }

    startUpdateBalances(utg) {
        const balanceSource = () => {
            return  from(utg.getBalances()).pipe(
                flatMap(balances => from(this.sendUpdateBalance(balances))
            ));
        };

        const poll = of({}).pipe(
            flatMap(_ => balanceSource()),
            delay(10000),
            repeat()
        );

        poll.subscribe();

    }

    /**
     *
     * @param order Order
     * @param trade Trade
     * @returns {Promise<Order>}
     */
    async sendTrade(order, trade) {

        const orionTrade = {
            "ordId": order.ordId,
            "subOrdId": order.subOrdId,
            "tradeId": trade.tradeId,
            "price": trade.price.toString(),
            "qty": trade.qty.toString(),
            "status": trade.status,
            "timestamp": trade.timestamp
        };

        console.info('Sending Trade: ', JSON.stringify(orionTrade));

        return fetch(`${this.orionUrl}/trade`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(orionTrade)
            })
            .then((response) => {
                if (!response.ok) {
                    throw Error(response.statusText);
                }
                return response.json();
            })
            .then((resOrder) => {
                trade.commited = true;

                return new Promise((resolve) => trade.save().then(_  =>
                    resolve(resOrder)));
            })
            .catch((error) => {
                throw error;
            });
    }
}

module.exports = {Broker};
