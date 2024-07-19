const express = require('express')
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000;
var cors = require('cors')
var jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');



const stripe = require('stripe')(process.env.STRIPE_KEY);
app.use(express.static('public'));


app.use(express.json())
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",

    ],
    credentials: true,
  })
);


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.r31xce1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});






async function run() {
  try {
    // // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();


    const userCollection = client.db("JobTask_DB").collection('usersData')
    const cashInCollection = client.db("JobTask_DB").collection('cashInData')
    const historyCollection = client.db("JobTask_DB").collection('historyData')



    // middleware 
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'Unauthorized access' });
      }

      const token = req.headers.authorization.split(' ')[1];
      if (!token) {
        return res.status(401).send({ message: 'Unauthorized access' });
      }

      jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
        if (err) {
          if (err.name === 'TokenExpiredError') {
            return res.status(401).send({ message: 'Token expired' });
          }
          return res.status(403).send({ message: 'Forbidden access' });
        }
        req.email = decoded.data;
        next();
      });
    };

    const verifyAgent = async (req, res, next) => {
      const tokenEmail = req.email;
      const query = { email: tokenEmail }
      const result = await userCollection.findOne(query)
      const isAgent = result?.role === 'agent'

      if (!isAgent) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }


    const verifyAdmin = async (req, res, next) => {
      const tokenEmail = req.email;
      const query = { email: tokenEmail }
      const result = await userCollection.findOne(query)
      const isAdmin = result?.role === 'admin'

      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }


    // jwt releted api 

    app.post('/jwt', async (req, res) => {
      const userInfo = req.body.userInfo

      const token = jwt.sign({
        data: userInfo
      }, process.env.ACCESS_TOKEN, { expiresIn: '1h' });
      res.send({ token })

    })

    app.post('/is-login', async (req, res) => {
      try {

        const token = req.body.token
        var decoded = jwt.verify(token, process.env.ACCESS_TOKEN);
        const email = decoded.data

        const existingUser = await userCollection.findOne({ email: email });
        if (existingUser) {
          res.send({ message: 'User is logged in', user: existingUser });
        } else {
          res.sendStatus(404);
        }
      } catch (error) {
        console.error('Error fetching user:', error);
        res.sendStatus(500);
      }
    });


    app.post('/signIn', async (req, res) => {

      const { email, password } = req.body;
      try {
        const user = await userCollection.findOne({ email: email });

        if (!user) {
          return res.status(400).send({ message: 'Invalid email ' });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
          return res.status(400).send({ message: 'Invalid  password' });
        }
        res.send({ message: 'Login successful', user });


      } catch (error) {
        res.sendStatus(500); // Internal server error
      }
    });




    // user Api start


    app.post('/addUser', async (req, res) => {
      const userInfo = req.body;

      const emailQuery = { email: userInfo.email };
      const mobileQuery = { mobile: userInfo.mobile };

      const existingEmailUser = await userCollection.findOne(emailQuery);
      if (existingEmailUser) {
        return res.send({ message: 'User already exists with this email', insertedId: null });
      }

      const existingMobileUser = await userCollection.findOne(mobileQuery);
      if (existingMobileUser) {
        return res.send({ message: 'User already exists with this mobile number', insertedId: null });
      }

      const result = await userCollection.insertOne(userInfo);
      if (result.insertedId) {
        res.send({ message: 'Completed, Please Wait for Admin Confirmation', insertedId: result.insertedId });
      }
      res.send(result);
    });


    app.get('/allUser', verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray()
      res.send(result)

    })

    // cash in Routes 
    app.post('/addCashInData/:mobile', verifyToken, async (req, res) => {
    const cashInData = req.body;
    const mobile = req.params.mobile;

    const query = { mobile: mobile, role: 'agent' };

    const agent = await userCollection.findOne(query); 
    if (!agent) {
        return res.send({ message: 'This is not an agent number' });
    }

    const result = await cashInCollection.insertOne(cashInData);
    if(result.insertedId){
     return res.send({message:'Request submitted, wait for agent confirmation',result});
    }
    res.send(result);
});

app.get('/addCashInData/:mobile', verifyToken, verifyAgent, async (req, res) => {
  const mobile = req.params.mobile;

  const query = { 
      agentNumber: mobile,
      status: 'pending'
  };

  const result = await cashInCollection.find(query).toArray();

  res.send(result);
});



app.patch('/agent/cashIn', verifyToken, verifyAgent, async (req, res) => {
  try {
      const userSendMoney = req.body;
      const dataId = userSendMoney.cashInDataId;
      const agentPassword = userSendMoney.agentPassword;
      const agentMobile = userSendMoney.agentNumber;
      const userMobile = userSendMoney.userNumber;
      const amount = parseFloat(userSendMoney.amount);

      const agent = await userCollection.findOne({ mobile: agentMobile });

      if (!agent) {
          return res.send({ status: 'error', message: 'Invalid Agent' });
      }

      const isMatch = await bcrypt.compare(agentPassword, agent.password);

      if (!isMatch) {
          return res.send({ status: 'error', message: 'Invalid Pin' });
      }

      const user = await userCollection.findOne({ mobile: userMobile });
      if (!user) {
          return res.send({ status: 'error', message: 'Invalid User Number' });
      }

      const agentBalance = parseFloat(agent.balance);
      const userBalance = parseFloat(user.balance);

      
      if (agentBalance < amount) {
          return res.send({ status: 'error', message: 'Agent does not have enough balance' });
      }

      const newAgentBalance = agentBalance - amount;
      const newUserBalance = userBalance + amount;

      
      const updateUserResult = await userCollection.updateOne(
          { mobile: userMobile },
          { $set: { balance: newUserBalance } }
      );

      const updateAgentResult = await userCollection.updateOne(
          { mobile: agentMobile },
          { $set: { balance: newAgentBalance } }
      );

      if (updateUserResult.modifiedCount > 0 && updateAgentResult.modifiedCount > 0) {
          
          const updateStatus = await cashInCollection.updateOne(
              { _id: new ObjectId(dataId) },
              { $set: { status: 'completed' } }
          );

          if (updateStatus.modifiedCount > 0) {
              const historyResult = await historyCollection.insertOne(userSendMoney);

              return res.send({ status: 'success', message: 'Balance updated successfully', newUserBalance, newAgentBalance });
          } else {
              return res.send({ status: 'error', message: 'Failed to update cash-in status' });
          }
      } else {
          return res.send({ status: 'error', message: 'Failed to update balances' });
      }
  } catch (error) {
      return res.send({ status: 'error', message: 'Internal Server Error' });
  }
});


// agent  TransactionHistory
app.get('/agent/transactionHistory/:mobile',  async (req, res) => {
  const phone = req.params.mobile;

  try {
      const transactions = await historyCollection
          .find({ agentNumber : phone }) 
          .sort({ date: -1 })     
          .limit(20)              
          .toArray();

      res.send({ transactions });
  }
   catch (error) {
      res.status(500).send({ error: 'An error occurred while fetching transaction history.' });
  }
});
// user  TransactionHistory
app.get('/user/transactionHistory/:mobile',  async (req, res) => {
  const phone = req.params.mobile;

  try {
      const transactions = await historyCollection
          .find({ userNumber : phone }) 
          .sort({ date: -1 })     
          .limit(20)              
          .toArray();

      res.send({ transactions });
  }
   catch (error) {
      res.status(500).send({ error: 'An error occurred while fetching transaction history.' });
  }
});

  // user Cash Out   start
  app.post('/user/cashOut', verifyToken, async (req, res) => {
    try {
        
        const userSendMoney = req.body;
        const dataId = userSendMoney.cashInDataId;
        const password = userSendMoney.password;
        const agentMobile = userSendMoney.agentNumber;
        const userMobile = userSendMoney.userNumber;
        const amount = parseFloat(userSendMoney.amount);
  
        const agent = await userCollection.findOne({ mobile: agentMobile });
  
        if (!agent) {
            return res.send({ status: 'error', message: 'Invalid Agent Number' });
        }
  
       
  
        const user = await userCollection.findOne({ mobile: userMobile });
        if (!user) {
            return res.send({ status: 'error', message: 'Invalid User' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
  
        if (!isMatch) {
            return res.send({ status: 'error', message: 'Invalid Pin' });
        }
        const agentBalance = parseFloat(agent.balance);
        const userBalance = parseFloat(user.balance);
  
        
        if (userBalance < amount) {
            return res.send({ status: 'error', message: ' You don`t have enough balance' });
        }
  
        const newAgentBalance = agentBalance + amount;
        const newUserBalance = userBalance - amount;
  
        
        const updateUserResult = await userCollection.updateOne(
            { mobile: userMobile },
            { $set: { balance: newUserBalance } }
        );
  
        const updateAgentResult = await userCollection.updateOne(
            { mobile: agentMobile },
            { $set: { balance: newAgentBalance } }
        );
  
        if (updateUserResult.modifiedCount > 0 && updateAgentResult.modifiedCount > 0) {
            
                const historyResult = await historyCollection.insertOne({...userSendMoney,agentName:agent.name});
  
                return res.send({ status: 'success', message: 'CashOut  successfully Completed', newUserBalance, newAgentBalance });
            
        } else {
            return res.send({ status: 'error', message: 'Failed to update balances' });
        }
    } catch (error) {
        return res.send({ status: 'error', message: 'Internal Server Error' });
    }
  });
  
  


  // user Cash Out   end 


  // user send money start

  app.post('/user/sendMoney', verifyToken, async (req, res) => {
    const userSendMoney = req.body;
    try {
        
 
        const password = userSendMoney?.password;
        const receiverMobile = userSendMoney?.receiverNumber;
        const userMobile = userSendMoney?.userNumber;
        const amount = parseFloat(userSendMoney?.amount);
  
        const receiver = await userCollection.findOne({ mobile:receiverMobile });
  
        if (!receiver) {
            return res.send({ status: 'error', message: 'Invalid Number' });
        }
  
      
  
        const user = await userCollection.findOne({ mobile: userMobile });
        if (!user) {
            return res.send({ status: 'error', message: 'Invalid User' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
  
        if (!isMatch) {
            return res.send({ status: 'error', message: 'Invalid Pin' });
        }
        const receiverBalance = parseFloat(receiver.balance);
        const userBalance = parseFloat(user.balance);

        
        if (userBalance < amount) {
            return res.send({ status: 'error', message: ' You don`t have enough balance' });
        }
  
        const newReceiverBalance = receiverBalance + amount;
        const newUserBalance = userBalance - amount;
  
       
        const updateUserResult = await userCollection.updateOne(
            { mobile: userMobile },
            { $set: { balance: newUserBalance } }
        );
  
        const updateReceiverResult = await userCollection.updateOne(
            { mobile: receiverMobile },
            { $set: { balance: newReceiverBalance } }
        );
  


        if (updateUserResult.modifiedCount > 0 && updateReceiverResult.modifiedCount > 0) {
            
                const historyResult = await historyCollection.insertOne({...userSendMoney,receiverName:receiver.name});
  
                return res.send({ status: 'success', message: 'Send Money  successfully Completed'});
            
        } else {
            return res.send({ status: 'error', message: 'Failed to update balances' });
        }
    } catch (error) {
        return res.send({ status: 'error', message: 'Internal Server Error' });
    }
  });
  
  

  // user send money end 



    // change user role by admin 


    app.patch('/user/admin/role/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;

      const query = { _id: new ObjectId(id) };
      const user = await userCollection.findOne(query);

      if (!user) {
        return res.status(404).send({ message: 'User not found' });
      }
    
      let updateDoc = {
        $set: { role: role }
      };


      if (role === 'user' && user.balance === 0) {
        updateDoc.$set.balance = 40;
      } else if (role === 'agent' && user.balance === 0) {
        updateDoc.$set.balance = 10000;
      }

      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });


    // delete user 

    app.delete('/user/admin/delete/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query);
      res.send(result);

    })

//  admin  All  Transaction

app.get('/admin/AllTransaction', verifyToken,verifyAdmin , async(req,res)=>{
  const result= await historyCollection.find().toArray()
 return  res.send(result)
})
app.get('/users', async(req,res)=>{
  const result= await historyCollection.find().toArray()
 return  res.send(result)
})







    // // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send(' Server is Running')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})