// server.js
const express = require("express");
const admin = require("firebase-admin");
const app = express();
const PORT = process.env.PORT || 5000;

const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");



const serviceAccount = require("./firebase_admin_key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mk63pzz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("parcelDB");
    const usersCollection = db.collection("users")
    const parcelCollection = db.collection("parcels");
    const paymentsCollection = db.collection("payments");


    // custom middleware 
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if(!authHeader){
       return res.status(401).send({message: "unauthrized access"})
      }
      const token = authHeader.split(" ")[1];
      if(!token){
        return res.status(401).send({message: "unauthrized access"})
      }
      // verify the token 
      try{
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded
        next();
      }
      catch(error){
        return res.status(403).send({message: "unauthrized access"})
      }


      
    }



      // users api 
      app.post("/users", async (req, res) => {
        const email = req.body.email;
        const userExists = await usersCollection.findOne({ email })
        if(userExists){
          // update last log in 
         return res.status(200).send({ message: "user already exists ", 
          inserted: false
         });
        }
        const user = req.body;
        const result = await usersCollection.insertOne(user)
        res.send(result)
      })

    // GET all parcels OR by user, latest first
    app.get("/parcels", verifyFBToken,  async (req, res) => {
      try {
        const userEmail = req.query.email;
        
        const query = userEmail ? { created_by: userEmail } : {};
        const options = { sort: { createdAt: -1 } };

        const parcels = await parcelCollection.find(query, options).toArray();
        res.send(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).send({ message: "Failed to get parcels" });
      }
    });

    // GET a specific parcel
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel)
          return res.status(404).json({ message: "Parcel not found" });

        res.status(200).json(parcel);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Error fetching parcel", error: error.message });
      }
    });

    // POST new parcel
    app.post("/parcels", async (req, res) => {
      try {
        const newParcel = req.body;
        const result = await parcelCollection.insertOne(newParcel);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error inserting parcel:", error);
        res.status(500).send({ message: "Failed to create parcel" });
      }
    });

    // DELETE parcel
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await parcelCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.error("Error deleting parcel:", error);
        res.status(500).send({ message: "Failed to delete parcel" });
      }
    });

    app.post("/tracking", async (req, res) => {
      const {
        tracking_id,
        parcel_id,
        status,
        message,
        updated_by = "",
      } = req.body;

      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        updated_by,
      };

      const result = await trackingCollection.insertOne(log);
      res.send({ success: true, insertedId: result.insertedId });
    });

    

    // GET payments
    app.get("/payments", verifyFBToken , async (req, res) => {
      try {
        const userEmail = req.query.email;
        console.log("decoded", req.decoded)
        if(req.decoded.email !== userEmail){
          return res.status(403).send({message: "forbidden access"})
        }
        const query = userEmail ? { email: userEmail } : {};
        const options = { sort: { paid_at: -1 } };

        const payments = await paymentsCollection
          .find(query, options)
          .toArray();
        res.send(payments);
      } catch (error) {
        console.error("Error fetching payment history:", error);
        res.status(500).send({ message: "Failed to get payments" });
      }
    });

    // POST payment: mark parcel paid + save payment
    app.post("/payments", async (req, res) => {
      try {
        const { parcelId, email, amount, paymentMethod, transactionId } =
          req.body;

        // Update parcel payment_status
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { payment_status: "paid" } }
        );

        if (updateResult.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "Parcel not found or already paid" });
        }

        // Insert payment record
        const paymentDoc = {
          parcelId,
          email,
          amount,
          paymentMethod,
          transactionId,
          paid_at: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        res.status(201).send({
          message: "Payment recorded and parcel marked as paid",
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        console.error("Payment processing failed:", error);
        res.status(500).send({ message: "Failed to record payment" });
      }
    });

    // PaymentIntent
    app.post("/create-payment-intent", async (req, res) => {
      const { amountInCents } = req.body; // fixed spelling
      try {
        if (!amountInCents || typeof amountInCents !== "number") {
          return res.status(400).json({ error: "Invalid amount" });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amountInCents),
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Stripe PaymentIntent error:", error);
        res.status(500).json({ error: error.message });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB successfully!");
  } finally {
    // Do not close client in production
  }
}
run().catch(console.dir);

// Test route
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
