// server.js
const express = require('express')
const app = express();
const PORT = process.env.PORT || 5000;

const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();




// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
