const mongoose = require('mongoose');

//DEGEN db
mongoose.connect('mongodb://localhost:27017/ilus', {useNewUrlParser: true}, (err) =>{
    if(!err){
        console.log('MongoDB connected successfully')
    }
    else{
        console.log('Error in connecting Mongodb', +err);
    }
})

require('./transactionDetails');