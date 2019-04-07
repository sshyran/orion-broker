const Sequelize = require('sequelize');
const {Status} = require("orion-connectors");
const Op = Sequelize.Op;

const sequelize = new Sequelize('orders', null, null, {
    dialect: "sqlite",
    storage: './orders.sqlite',
    omitNull: true
});

const DbSubmitOrder = sequelize.define("submit_order", {
    id: {
        type: Sequelize.DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    side: Sequelize.DataTypes.STRING,
    pair: Sequelize.DataTypes.STRING,
    rate: Sequelize.DataTypes.DOUBLE,
    amount: Sequelize.DataTypes.DOUBLE
});

const DbOrder1 = sequelize.define("order1", {
    pair: {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
    },
    rate: {
        type: Sequelize.DataTypes.DECIMAL,
        allowNull: true
    },
    amount: {
        type: Sequelize.DataTypes.DOUBLE,
        allowNull: true
    },
    id: {
        type: Sequelize.DataTypes.STRING,
        primaryKey: true,
        allowNull: true
    },
    time: {
        type: Sequelize.DataTypes.DATE,
        allowNull: true
    },
    side: {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
    },
    exchange: {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
    },
    type: {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
    },

    status: {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
    },
    submitOrder_id: {
        type: Sequelize.DataTypes.INTEGER,
        references: {
            model: DbSubmitOrder,
            key: 'id'
        },
        allowNull: true
    },
    error: {
        allowNull: true,
        type: Sequelize.DataTypes.STRING
    }
});

const DbOrder = sequelize.define("order", {
    id: { type: Sequelize.DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    exchange: { type: Sequelize.DataTypes.STRING, unique: 'exchangeOrdId' },

    exchangeOrdId: { type: Sequelize.DataTypes.STRING, unique: 'exchangeOrdId' },

    ordId: { type: Sequelize.DataTypes.STRING, unique: 'clientOrdId' },

    subOrdId: { type: Sequelize.DataTypes.STRING, unique: 'clientOrdId' },

    symbol: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false
    },
    price: {
        type: Sequelize.DataTypes.DECIMAL,
        allowNull: false
    },
    ordQty: {
        type: Sequelize.DataTypes.DECIMAL,
        allowNull: false
    },
    side: {
        type: Sequelize.DataTypes.STRING,
        allowNull: false
    },

    timestamp: { type: Sequelize.DataTypes.BIGINT(13), allowNull: false },

    ordType: {type: Sequelize.DataTypes.STRING, allowNull: false},

    filledQty: {type: Sequelize.DataTypes.DECIMAL(18,8), defaultValue: 0},

    totalCost: {type: Sequelize.DataTypes.DECIMAL(18,8), defaultValue: 0},

    status: {type: Sequelize.DataTypes.STRING, allowNull: false},

    error: {
        type: Sequelize.DataTypes.STRING,
        allowNull: true
    }
});

const DbTrade = sequelize.define("trade", {
    id: { type: Sequelize.DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    tradeId: { type: Sequelize.DataTypes.STRING, unique: 'compositePk' },

    exchange: { type: Sequelize.DataTypes.STRING, unique: 'compositePk' },

    exchangeOrdId: { type: Sequelize.DataTypes.STRING, unique: 'compositePk' },

    price: {
        type: Sequelize.DataTypes.DECIMAL(18,8),
        allowNull: false
    },

    qty: {
        type: Sequelize.DataTypes.DECIMAL(18,8),
        allowNull: false
    },

    status: { type: Sequelize.DataTypes.STRING, allowNull: true },

    timestamp: { type: Sequelize.DataTypes.BIGINT(13), allowNull: false },

    commited: { type: Sequelize.DataTypes.BOOLEAN, defaultValue: false},
});

DbTrade.belongsTo(DbOrder, {foreignKey: 'fkOrderId'});
DbOrder.hasMany(DbTrade, {foreignKey: 'fkOrderId', as: 'fills'});

class OrderService {
    static async getOpenOrders() {
        return DbOrder.findAll({
            where: {
                status: {
                    [Op.in]: [Status.NEW, Status.PARTIALLY_FILLED],
                }
            }
        });
    }

    static async getAllOrders() {
        return DbOrder.findAll({ include: [{model: DbTrade, as: 'fills'}],
            order: [ ['timestamp', 'DESC'], [{model: DbTrade, as: 'fills'},'timestamp', 'DESC'] ] });
    }
}

sequelize.sync();

module.exports = {DbOrder, DbTrade, OrderService};