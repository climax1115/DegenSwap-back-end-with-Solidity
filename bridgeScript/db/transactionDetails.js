const mongoose = require('mongoose');
var transactionDetails = new mongoose.Schema({
    token: {
        type: String,
        required: 'Token field is required.'
    },
    amount: {
        type: String,
        required: 'Amount field is required.'
    },
    userAddress: {
        type: String,
        required: 'User Address field is required.'
    },
    transactionHash: {
        type: String
    },
    transactionStatus: {
        type: String,
        required: 'Transaction Status field is required.'
    },
    chain: {
        type: String,
        required: 'Chain is required'
    },
    token_image: {
        type: String
    },
    time: {
        type: String,
        required: 'Transaction Time field is required.'
    },
    transactionType: {
        type: String
    },
    crossChainTrx : {
        type: String,
        required: 'Cross chain trx field is required.'
    }
});


mongoose.model('transactionDetails', transactionDetails);