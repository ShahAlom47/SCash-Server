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
              return res.status(403).send({ message: 'Forbidden access' });
          }
          req.email = decoded.data; 
         
          next();
      });
  };

    const verifyAgent = async (req, res, next) => {
      const tokenEmail = req.decoded.data;
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
      // console.log(tokenEmail);
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

        const token=req.body.token
        var decoded = jwt.verify(token, process.env.ACCESS_TOKEN);
        const email=decoded.data

          const existingUser = await userCollection.findOne({ email: email });
          if (existingUser) {
              res.send({ message: 'User is logged in', user: existingUser });
          } else {
              res.sendStatus(404); // User not found
          }
      } catch (error) {
          console.error('Error fetching user:', error);
          res.sendStatus(500); // Internal server error
      }
  });


  app.post('/signIn', async (req, res) => {
 
    const { email, password } = req.body;
    // console.log();
    try {
      const user = await userCollection.findOne({ email:email });

      if (!user) {
          return res.status(400).send({ message: 'Invalid email ' });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
          return res.status(400).send({ message: 'Invalid  password' });
      }
      res.send({ message: 'Login successful', user});

      console.log(email);
     
    } catch (error) {
        console.error('Error fetching user:', error);
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
    

    app.get('/allUser', verifyToken,verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray()
      res.send(result)

    })

    

    // change user role by admin 

    
app.patch('/user/admin/role/:id', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const { role } = req.body;
  console.log(id, role);

  const query = { _id: new ObjectId(id) };
  const user = await userCollection.findOne(query);

  if (!user) {
      return res.status(404).send({ message: 'User not found' });
  }
console.log(user);
  let updateDoc = {
      $set: { role: role }
  };


  if (role ==='user' && user. balance === 0) {
      updateDoc.$set.balance = 40;
  } else if (role === 'agent' && user.balance === 0) {
      updateDoc.$set.balance= 10000;
  }

  const result = await userCollection.updateOne(query, updateDoc);
  res.send(result);
});


// delete user 

app.delete('/user/admin/delete/:id', verifyToken,verifyAdmin, async (req, res) => {
  const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query);
      res.send(result);

})




    // ---------------------
    // PAYMENT History start
    // ---------------------
    app.post('/paymentHistory', async (req, res) => {
      const paymentData = req.body
      const offerCardId = paymentData.offerCardId;
      const transactionId = paymentData.transactionId;
      console.log(offerCardId, transactionId);
      const session = client.startSession();
      session.startTransaction();

      // const result= await paymentDataCollection.insertOne(paymentData)

      const statusUpdate = await offerDataCollection.updateOne(
        { _id: new ObjectId(offerCardId) },
        {
          $set: { verification_status: 'bought' },
          $push: { transactions: transactionId }
        },
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      res.send(statusUpdate)





    })


    // ---------------------
    // PAYMENT  History end 
    // ---------------------
    // ---------------------
    // PAYMENT 
    // ---------------------


    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { price } = req.body;
        const amount = parseInt(100 * price);
        const MAX_AMOUNT = 99999999; // in the smallest currency unit, for AED this is 999,999.99 AED

        if (amount > MAX_AMOUNT) {
          return res.status(400).send({ error: 'Amount must be no more than 999,999 AED' });
        }

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "aed",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).send({ error: 'Failed to create payment intent' });
      }
    });

    // ---------------------
    // PAYMENT 
    // ---------------------


    app.post('/create-checkout-session', async (req, res) => {
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, pr_1234) of the product you want to sell
            price: '{{PRICE_ID}}',
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${YOUR_DOMAIN}?success=true`,
        cancel_url: `${YOUR_DOMAIN}?canceled=true`,
      });

      res.redirect(303, session.url);
    });





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