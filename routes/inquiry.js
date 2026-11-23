
const express = require("express");
const { db } = require("../cms/database");

const router = express.Router();

const allowedBudgets = new Set([
    "₹20–40 Lakh",
    "₹40–60 Lakh",
    "₹60–80 Lakh",
    "₹80 Lakh and Above"
]);

function textField(value, label, maxLength, { required = false } = {}) {
    if (typeof value !== "string") {
        if (!required && value === undefined) return "";
        throw new TypeError(`${label} must be text.`);
    }

    const text = value.trim();

    if (required && !text) {
        throw new TypeError(`${label} is required.`);
    }

    if (text.length > maxLength) {
        throw new TypeError(
            `${label} must be ${maxLength} characters or fewer.`
        );
    }

    return text;
}

router.post("/", async (req, res) => {

    if (!req.body || typeof req.body !== "object" ||
        Array.isArray(req.body)) {
        return res.status(400).json({
            success: false,
            error: "Inquiry details are invalid."
        });
    }

    let inquiry;

    try {
        inquiry = {
            name: textField(req.body.name, "Name", 120, {
                required: true
            }),
            phone: textField(req.body.phone, "Phone number", 40, {
                required: true
            }),
            email: textField(req.body.email, "Email", 160),
            message: textField(req.body.message, "Message", 5000),
            budget: textField(req.body.budget, "Budget", 40),
            projectName: textField(req.body.projectName, "Project", 120),
            sourceForm: textField(
                req.body.sourceForm ||
                req.body.formType ||
                "Website enquiry",
                "Source form",
                120,
                { required: true }
            ),
            sourcePage: textField(
                req.body.sourcePage || "/",
                "Source page",
                300,
                { required: true }
            )
        };

        if (
            inquiry.email &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)
        ) {
            throw new TypeError("Enter a valid email address.");
        }

        if (
            inquiry.budget &&
            !allowedBudgets.has(inquiry.budget)
        ) {
            throw new TypeError("Choose a valid budget.");
        }

        if (
            Object.hasOwn(req.body, "budget") &&
            !inquiry.budget
        ) {
            throw new TypeError("Choose a budget.");
        }

    } catch (error) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }

    // Google Apps Script URL from Render environment
    const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

    if (!GOOGLE_SCRIPT_URL) {
        return res.status(500).json({
            success: false,
            error: "Google Sheets integration is not configured."
        });
    }

    const submittedAt = new Date().toISOString();

    try {

        // 1. Save inquiry in existing SQLite database
        const result = db.prepare(`
            INSERT INTO inquiries
                (name, phone, email, message, budget,
                project_name, source_form, source_page,
                status, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
        `).run(
            inquiry.name,
            inquiry.phone,
            inquiry.email,
            inquiry.message,
            inquiry.budget,
            inquiry.projectName,
            inquiry.sourceForm,
            inquiry.sourcePage,
            submittedAt
        );

        const inquiryId = Number(result.lastInsertRowid);

        // 2. Send inquiry to Google Sheets
        let googleSheetSaved = false;

        try {
            const sheetResponse = await fetch(GOOGLE_SCRIPT_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    inquiryId,
                    ...inquiry,
                    submittedAt
                }),
                redirect: "follow"
            });

            const sheetResult = await sheetResponse.json();

            if (
                !sheetResponse.ok ||
                sheetResult.success !== true
            ) {
                throw new Error(
                    sheetResult.error || "Google Sheets save failed."
                );
            }

            googleSheetSaved = true;

        } catch (sheetError) {
            console.error(
                "Google Sheets sync failed:",
                sheetError.message
            );
        }

        // 3. Return response
        return res.status(201).json({
            success: true,
            message: googleSheetSaved
                ? "Inquiry saved successfully."
                : "Inquiry saved in website database. Google Sheets sync is pending.",
            googleSheetSaved,
            inquiry: {
                id: inquiryId,
                submittedAt
            }
        });

    } catch (error) {

        console.error(
            "Inquiry persistence failed:",
            error.code || error.name || "database error"
        );

        return res.status(500).json({
            success: false,
            error: "Unable to save your inquiry right now. Please try again."
        });
    }
});

module.exports = router;
