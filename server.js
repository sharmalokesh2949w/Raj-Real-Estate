const express = require("express");
const cors = require("cors");
require("dotenv").config();

const inquiryRoute = require("./routes/inquiry");
const careerRoute = require("./routes/career");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/inquiry", inquiryRoute);
app.use("/api/career", careerRoute);

app.get("/", (req, res) => {
    res.send("Raj Real Estate Backend Running...");
});
console.log("PORT =", process.env.PORT);
console.log("GOOGLE_SCRIPT_URL =", process.env.GOOGLE_SCRIPT_URL);
const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
