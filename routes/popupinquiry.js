
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

        const params = new URLSearchParams();
        params.append("sheet", "Inquiries");
        params.append("name", name);
        params.append("phone", phone);
        params.append("email", "");
        params.append("message", "Budget: " + budget);
        params.append("projectName", "General form");

        const response = await axios.post(
            process.env.GOOGLE_SCRIPT_URL,
            params
        );

        return res.json({
            success: true,
            source: "Popup Form",
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
