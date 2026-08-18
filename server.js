const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const inquiryRoute = require("./routes/inquiry");
const careerRoute = require("./routes/career");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (HTML, CSS, JS, images) from the root folder
app.use(express.static(path.join(__dirname)));

// API routes
app.use("/api/inquiry", inquiryRoute);
app.use("/api/career", careerRoute);

// Serve index.html for the root route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Explicit routes for other HTML pages (optional but ensures clean handling)
const pages = ["about", "career", "contact", "projects", "why-us"];
pages.forEach((page) => {
    app.get(`/${page}.html`, (req, res) => {
        res.sendFile(path.join(__dirname, `${page}.html`));
    });
});

// Only listen on a port when running locally (not on Vercel)
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

// Export the app for Vercel's serverless environment
module.exports = app;
