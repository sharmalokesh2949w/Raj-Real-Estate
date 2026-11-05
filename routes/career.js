const express = require("express");
const axios = require("axios");

const router = express.Router();

router.post("/", async (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ success: false, error: "Application details are invalid." });
    }

    const {
        name,
        phone,
        email,
        address,
        qualification,
        experience,
        appliedPosition,
        resumeUrl,
        coverLetter
    } = req.body;

    const requiredFields = {
        name,
        phone,
        email,
        address,
        qualification,
        experience,
        appliedPosition
    };
    if (Object.entries(requiredFields).some(([, value]) =>
        typeof value !== "string" || !value.trim()
    )) {
        return res.status(400).json({
            success: false,
            error: "Complete all required application fields."
        });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: "Enter a valid email address." });
    }
    if (Object.entries({ name, phone, email, address, qualification, experience, appliedPosition })
        .some(([field, value]) => value.length > (field === "address" ? 500 : 160))) {
        return res.status(400).json({ success: false, error: "One or more application fields are too long." });
    }
    if (coverLetter !== undefined &&
        (typeof coverLetter !== "string" || coverLetter.length > 5000)) {
        return res.status(400).json({ success: false, error: "Cover letter must be text of 5000 characters or fewer." });
    }
    if (resumeUrl !== undefined && typeof resumeUrl !== "string") {
        return res.status(400).json({ success: false, error: "Resume URL must be a secure web address." });
    }

    const cleanResumeUrl = (resumeUrl || "").trim();
    if (cleanResumeUrl) {
        try {
            const parsedResumeUrl = new URL(cleanResumeUrl);
            if (parsedResumeUrl.protocol !== "https:" ||
                parsedResumeUrl.username || parsedResumeUrl.password ||
                cleanResumeUrl.length > 2048) {
                throw new Error("invalid resume URL");
            }
        } catch {
            return res.status(400).json({ success: false, error: "Resume URL must be a valid HTTPS address." });
        }
    }

    const configuredScriptUrl = process.env.GOOGLE_SCRIPT_URL?.trim();
    let scriptUrl;
    try {
        scriptUrl = new URL(configuredScriptUrl);
    } catch {
        return res.status(503).json({
            success: false,
            error: "Career applications are temporarily unavailable. Please try again later."
        });
    }
    if (scriptUrl.protocol !== "https:") {
        return res.status(503).json({
            success: false,
            error: "Career applications are temporarily unavailable. Please try again later."
        });
    }

    const submissionId = req.get("Idempotency-Key");
    if (submissionId && !/^[A-Za-z0-9_-]{16,100}$/.test(submissionId)) {
        return res.status(400).json({
            success: false,
            error: "Submission key is invalid."
        });
    }

    const params = new URLSearchParams({
        sheet: "Careers",
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        qualification: qualification.trim(),
        experience: experience.trim(),
        position: appliedPosition.trim(),
        resumeUrl: cleanResumeUrl,
        coverLetter: typeof coverLetter === "string" ? coverLetter.trim() : "",
        ...(submissionId ? { submissionId } : {}),
        ...(process.env.GOOGLE_SHEETS_SHARED_SECRET
            ? { sharedSecret: process.env.GOOGLE_SHEETS_SHARED_SECRET }
            : {})
    });

    try {
        const response = await axios.post(scriptUrl.href, params);
        if (response.data && typeof response.data === "object" && response.data.success === false) {
            return res.status(502).json({
                success: false,
                error: "Unable to submit your application right now."
            });
        }
        res.json({
            success: true,
            message: "Application submitted."
        });
    } catch (err) {
        console.error("Career application forwarding failed:", err.response?.status || err.code || "upstream error");
        return res.status(502).json({
            success: false,
            error: "Unable to submit your application right now."
        });
    }
});

module.exports = router;