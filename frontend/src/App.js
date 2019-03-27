import React, { Component } from 'react';
import { Button, Form, FormGroup, Label, Input, Row, Col, Table, ListGroup, ListGroupItem, ListGroupItemHeading, ListGroupItemText } from 'reactstrap';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';
import fetch from 'node-fetch';

const BrokerHost = '127.0.0.1';

class App extends Component {
    constructor(props) {
        super(props);

        this.state = {
            pair: 'XRP-BTC',
            side: 'BUY',
            amount: 2.0,
            rate: 0.0005,
            orders: [],
            hidden: "hidden"
        };

    }

    componentDidMount = () => {
        let socket = new WebSocket(`ws://${BrokerHost}:8080`);

        socket.onopen = (event) => {
            socket.send("orderwatcher");
        };

        socket.onmessage = (message) => {
            const newOrder = JSON.parse(message.data);
            let orders = this.state.orders;
            console.log("Got message from websocket", newOrder, orders);
            let status = false;

            orders = orders.map(o => {
                if (o.id === newOrder.id) {
                    status = true;
                    return newOrder;
                } else {
                    return o;
                }
            });

            if (!status) {
                orders.unshift(newOrder);
                status = true;
            }

            if (status) {
                toast.info("Update an order " + newOrder.id, {
                    position: toast.POSITION.TOP_RIGHT
                });
            } else {
                toast.error("Cannot update an order " + newOrder.id, {
                    position: toast.POSITION.TOP_RIGHT
                })
            }

            this.setState({orders});
        };

        fetch(`http://${BrokerHost}:3000/api/openorders`)
            .then(res => res.json())
            .then((result) => {
                if (result.hasOwnProperty("errors")) {
                    result.errors.forEach((order, i) => {
                        toast.error("Cannot create order on the " + order.exchange, {
                            position: toast.POSITION.TOP_RIGHT
                        });
                    });
                    delete result.errors;
                    //Errors
                }

                this.setState({orders: result})})
            .catch((error) => {
                toast.error(error.message, {
                    position: toast.POSITION.TOP_RIGHT
                });
            });
    };

    parseDate(date) {
        const parsedDate = new Date(date);
        return (parsedDate.getDate()<10?"0" + parsedDate.getDate() : parsedDate.getDate())
            + "/" + (parsedDate.getMonth()+1)
            + "/" + parsedDate.getFullYear()
            + " " + (parsedDate.getHours()<10?"0" + parsedDate.getHours() : parsedDate.getHours())
            + ":" + (parsedDate.getMinutes()<10?"0" + parsedDate.getMinutes() : parsedDate.getMinutes())
    }

    handlePairChange = (event) => {
        this.setState({pair: event.target.value});
    };

    handleRateChange = (event) => {
        this.setState({rate: event.target.value});
    };

    handleAmountChange = (event) => {
        this.setState({amount: event.target.value});
    };

    handleSideChange = (event) => {
        this.setState({side: event.target.value});
    };

    switchTable = (id) => (event) => {
        let item = document.getElementById(id).classList;
        if (item.contains("hidden")) {
            item.remove("hidden");
        } else {
            item.add("hidden");
        }
    };

    handleSubmitOrder = (event) => {
        event.preventDefault();

        const headers = new Headers({
            'Content-Type': 'application/json'
        });

        const maxOrdId = this.state.orders.reduce((p, o) => (p > o.ordId) ? p : o.ordId, 0);

        let body = JSON.stringify({
            "symbol": this.state.pair,
            "ordId": Number(maxOrdId) + 1,
            "subOrdId": 1,
            "side": this.state.side,
            "price": this.state.rate,
            "exchange": "binance",
            "subOrdQty": this.state.amount,
            "ordType": "LIMIT"
        });

        fetch(`http://${BrokerHost}:3000/api/order`, {method: 'POST', body, headers})
            .then((orders) => orders.json())
            .then((result) => {
                if (result.hasOwnProperty("errors")) {
                    result.errors.forEach((order, i) => {
                        toast.error("Cannot create order on the " + order.exchange, {
                            position: toast.POSITION.TOP_RIGHT
                        });
                    });

                    delete result.errors;
                }

                //let orders = this.state.orders;
                //orders.unshift(result);
                //this.setState({orders});
            })
            .catch((error) => {
                toast.error(error.message, {
                    position: toast.POSITION.TOP_RIGHT
                });
            });
    };

    handleCloseOrder = (id, submitId = false) => (event) => {
        event.preventDefault();

        const headers = new Headers({
            'Content-Type': 'application/json'
        });

        let body = submitId?
            JSON.stringify({
                "submitId": id
            }):
            JSON.stringify({
                "id": id
            });

        fetch(`http://${BrokerHost}:3000/api/cancelorder`, {method: 'POST', body, headers})
            .then((orders) => orders.json())
            .then((orders) => {
                orders.forEach((order, i) => {
                    if (typeof order === "object") {
                        toast.error("Cannot delete order " + order.result.id + ", order is not open or not exist", {
                            position: toast.POSITION.TOP_RIGHT
                        });
                        delete orders[i];
                    }
                });

                let newOrders = this.state.orders;

                newOrders.forEach((order, i) => {
                    order.exchanges.forEach((sOrder, i) => {
                        if (orders.includes(sOrder.id)) {
                            sOrder.status = "closed";
                        }
                    });
                });

                this.setState({orders: newOrders})})
            .catch((error) => {
                toast.error(error.message, {
                    position: toast.POSITION.TOP_RIGHT
                });
                console.log(error.message);
            })
    };

    isUnknownOrder = (order) => {
        if (order.hasOwnProperty('fills') && order.fills.length > 0) {
            return (
                <Table bordered className={this.state.hidden} id={"switch-" + order.id}>
                    {order.fills.map((trade, i) => {
                        if (trade.hasOwnProperty("error") && trade.error !== null && trade.error.length > 0) {
                            return (
                                <tr>
                                    <td>Exchange: <strong>{trade.exchange}</strong></td>
                                    <td>Error: {trade.error}</td>
                                </tr>
                            )
                        } else {
                            return (
                                <tr>
                                    <td>
                                        Exchange: <strong>{trade.exchange}</strong><br/>
                                        <label className="small">ID: {trade.exchangeOrdId}</label>
                                    </td>
                                    <td>Quantity: {trade.qty}</td>
                                    <td>Price: {trade.price}</td>
                                    <td>Type:</td>
                                    <td>Status: {trade.status !== "closed" ?
                                        <a href="#"
                                           onClick={this.handleCloseOrder(trade.id)}>{trade.status ? trade.status : "opened"}</a> :
                                        <span>{trade.status}</span>}</td>
                                </tr>
                            )
                        }
                    })
                    }
                </Table>
            );
        } else {
            return (
                <Table bordered className={this.state.hidden} id={"switch-" + order.id}/>
            )
        }
    };

    render() {
        return (
            <div className="container">
                <Form className="align-items-center align-content-center container" onSubmit={this.handleSubmitOrder}>
                    <h2>Submit order</h2>
                    <Row form>
                        <Col md={3}>
                            <FormGroup>
                                <Label for="field-pair">Pair</Label>
                                <Input id="field-pair" value={this.state.pair} onChange={this.handlePairChange}/>
                            </FormGroup>
                        </Col>
                        <Col md={3}>
                            <FormGroup>
                                <Label for="field-amount">Amount</Label>
                                <Input type="number" id="field-amount" value={this.state.amount} onChange={this.handleAmountChange}/>
                            </FormGroup>
                        </Col>
                        <Col md={3}>
                            <FormGroup>
                                <Label for="field-rate">Rate</Label>
                                <Input type="number" id="field-rate" value={this.state.rate} onChange={this.handleRateChange}/>
                            </FormGroup>
                        </Col>
                        <Col md={2}>
                            <FormGroup>
                                <Label for="field-side">Side</Label>
                                <Input type="select" id="field-side" value={this.state.side} onChange={this.handleSideChange}>
                                    <option value="buy">buy</option>
                                    <option value="sell">sell</option>
                                </Input>
                            </FormGroup>
                        </Col>
                        <Col md={1} className="align-items-end">
                            <Label for="btn-submit">Submit</Label>
                            <Button block id="btn-submit" type="submit">Submit</Button>
                        </Col>
                    </Row>
                </Form>
                <ListGroup>
                {this.state.orders.map((order) => {
                    return (
                        <ListGroupItem className="text-center">
                            <div className="row switcher" onClick={this.switchTable("switch-" + order.id)}>
                                <h4 className="w-25">Pair: {order.symbol}</h4>
                                <h4 className="w-25">Amount: {order.ordQty}</h4>
                                <h4 className="w-25"> Price: {order.price}</h4>
                                <h4 className="w-25"> Side: {order.side}</h4>
                            </div>
                            {this.isUnknownOrder(order)}
                        </ListGroupItem>
                    )
                })}
                </ListGroup>

                <ToastContainer />
            </div>
        );
    }
}

export default App;
