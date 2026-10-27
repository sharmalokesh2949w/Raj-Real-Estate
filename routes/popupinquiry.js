
const express = require("express");
const axios = require("axios");

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const { name, phone, budget } = req.body;

        if (!name || !phone || !budget) {
            return res.status(400).json({
                success: false,
                error: "Name, phone and budget are required."
            });
        }

        const scriptUrl = process.env.GOOGLE_SCRIPT_URL;

        if (!scriptUrl) {
            return res.status(500).json({
                success: false,
                error: "Google Script URL is not configured."
            });
        }

        const params = new URLSearchParams();
        params.append("sheet", "Popup Inquiries");
        params.append("name", name);
        params.append("phone", phone);
        params.append("email", "");
        params.append("message", "Budget: " + budget);
        params.append("projectName", "Website Popup Inquiry");

        const response = await axios.post(scriptUrl, params);

        return res.json({
            success: true,
            response: response.data
        });

    } catch (error) {
        console.error("Popup inquiry error:", error.message);

        return res.status(500).json({
            success: false,
            error: "Unable to save popup inquiry."
        });
    }
});

module.exports = router;
