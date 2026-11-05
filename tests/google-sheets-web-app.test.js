const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "scripts", "google-sheets-web-app.gs");
const secret = "local-test-shared-secret-at-least-thirty-two";
const spreadsheetId = "local-test-spreadsheet";

class FakeSheet {
    constructor(name, rows = []) {
        this.name = name;
        this.rows = rows.map(row => [...row]);
    }

    getLastColumn() {
        return Math.max(0, ...this.rows.map(row => row.length));
    }

    getLastRow() {
        return this.rows.length;
    }

    getRange(row, column, rowCount = 1, columnCount = 1) {
        return {
            getDisplayValues: () => Array.from({ length: rowCount }, (_, rowOffset) =>
                Array.from({ length: columnCount }, (_, columnOffset) =>
                    this.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ""
                )
            ),
            setValues: values => values.forEach((valuesRow, rowOffset) => {
                const targetRow = this.rows[row - 1 + rowOffset] ||
                    (this.rows[row - 1 + rowOffset] = []);
                valuesRow.forEach((value, columnOffset) => {
                    targetRow[column - 1 + columnOffset] = value;
                });
            })
        };
    }

    appendRow(row) {
        this.rows.push([...row]);
    }
}

function createReceiver(sheets = {}) {
    const sheetMap = new Map(Object.entries(sheets));
    const properties = new Map([
        ["SPREADSHEET_ID", spreadsheetId],
        ["SHARED_SECRET", secret]
    ]);
    const context = {
        PropertiesService: {
            getScriptProperties: () => ({
                getProperty: key => properties.get(key) || ""
            })
        },
        SpreadsheetApp: {
            openById: id => {
                assert.equal(id, spreadsheetId);
                return {
                    getSheetByName: name => sheetMap.get(name) || null,
                    insertSheet: name => {
                        const sheet = new FakeSheet(name);
                        sheetMap.set(name, sheet);
                        return sheet;
                    }
                };
            }
        },
        LockService: {
            getScriptLock: () => ({
                waitLock() {},
                releaseLock() {}
            })
        },
        ContentService: {
            MimeType: { JSON: "application/json" },
            createTextOutput: text => ({
                setMimeType() {
                    return { text };
                }
            })
        },
        Date,
        JSON,
        Math,
        String,
        Object,
        Array,
        Set
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context);
    return {
        doPost: event => vm.runInContext("doPost", context)(event),
        sheets: sheetMap
    };
}

function jsonEvent(body, contentType = "application/json") {
    return {
        postData: {
            type: contentType,
            contents: JSON.stringify(body)
        },
        parameter: {}
    };
}

function responseBody(response) {
    return JSON.parse(response.text);
}

test("authenticated JSON writes to existing Inquiries tab without duplicating aliased headers", () => {
    const inquiries = new FakeSheet("Inquiries", [
        [
            "Timestamp", "Full Name", "Phone Number", "Email Address",
            "Inquiry Type", "Project", "Source Page", "Status", "Submission ID"
        ],
        ["old-date", "Existing customer", "111", "old@example.test", "Existing", "Old project", "/old", "new", ""]
    ]);
    const receiver = createReceiver({ Inquiries: inquiries });
    const submission = {
        sharedSecret: secret,
        submissionId: "inquiry-test-submission-0001",
        type: "inquiry",
        record: {
            date: "2026-11-05T00:00:00.000Z",
            name: "LOCAL_AUDIT_TEST",
            phone: "0000000000",
            email: "local@example.test",
            budget: "₹40–60 Lakh",
            subject: "Project question",
            message: "Synthetic enquiry",
            enquiryType: "Project Enquiry",
            projectName: "Local project",
            source: "/projects/local-project",
            status: "new"
        }
    };

    const first = responseBody(receiver.doPost(jsonEvent(submission)));
    assert.deepEqual(first, { success: true, duplicate: false });
    assert.equal(receiver.sheets.has("Enquiries"), false);
    assert.deepEqual(inquiries.rows[1].slice(0, 8), [
        "old-date", "Existing customer", "111", "old@example.test",
        "Existing", "Old project", "/old", "new"
    ]);
    assert.equal(inquiries.rows.length, 3);

    const headers = inquiries.rows[0];
    assert.equal(headers.filter(header => header.toLowerCase() === "name").length, 0);
    assert.equal(headers.filter(header => header === "Full Name").length, 1);
    assert.equal(headers.filter(header => header === "Phone Number").length, 1);
    assert.equal(headers.filter(header => header === "Email Address").length, 1);
    assert.equal(inquiries.rows[2][headers.indexOf("Full Name")], "LOCAL_AUDIT_TEST");
    assert.equal(inquiries.rows[2][headers.indexOf("Phone Number")], "0000000000");
    assert.equal(inquiries.rows[2][headers.indexOf("Project")], "Local project");
    assert.equal(inquiries.rows[2][headers.indexOf("Submission ID")], submission.submissionId);

    const duplicate = responseBody(receiver.doPost(jsonEvent(submission)));
    assert.deepEqual(duplicate, { success: true, duplicate: true });
    assert.equal(inquiries.rows.length, 3);
});

test("JSON requests require the shared secret and malformed JSON cannot fall back to parameters", () => {
    const receiver = createReceiver();
    const unauthorized = responseBody(receiver.doPost(jsonEvent({
        sharedSecret: "wrong",
        submissionId: "json-submission-0001",
        type: "inquiry",
        record: { name: "LOCAL_AUDIT_TEST", phone: "0000000000" }
    })));
    assert.deepEqual(unauthorized, { success: false, errorCode: "unauthorized" });
    assert.equal(receiver.sheets.size, 0);

    const malformed = responseBody(receiver.doPost({
        postData: { type: "application/json", contents: "not-json" },
        parameter: { sheet: "Inquiries", name: "LOCAL_AUDIT_TEST", phone: "0000000000" }
    }));
    assert.deepEqual(malformed, { success: false, errorCode: "invalid_request" });
    assert.equal(receiver.sheets.size, 0);
});

test("legacy parameter submissions preserve Careers and map legacy inquiry sheet names", () => {
    const inquiries = new FakeSheet("Inquiries", [
        ["Date", "Name", "Phone", "Email", "Message", "Source", "Submission ID"]
    ]);
    const careers = new FakeSheet("Careers", [
        ["Timestamp", "Name", "Phone", "Email", "Position", "Resume URL", "Cover Letter"]
    ]);
    const receiver = createReceiver({ Inquiries: inquiries, Careers: careers });

    const career = responseBody(receiver.doPost({
        parameter: {
            sheet: "Careers",
            name: "Legacy applicant",
            phone: "1234567890",
            email: "applicant@example.test",
            address: "Jaipur",
            qualification: "Graduate",
            experience: "Two years",
            position: "Sales",
            resumeUrl: "https://example.test/resume.pdf",
            coverLetter: "Legacy form"
        }
    }));
    assert.deepEqual(career, { success: true, duplicate: false });
    assert.equal(careers.rows.length, 2);
    assert.equal(careers.rows[1][careers.rows[0].indexOf("Position")], "Sales");
    assert.equal(careers.rows[1][careers.rows[0].indexOf("Resume URL")], "https://example.test/resume.pdf");

    const inquiry = responseBody(receiver.doPost({
        parameter: {
            sheet: "Enquiries",
            name: "=formula-like value",
            phone: "0000000000",
            email: "customer@example.test",
            message: "Legacy parameter enquiry",
            sourcePage: "/contact",
            submissionId: "legacy-inquiry-0001"
        }
    }));
    assert.deepEqual(inquiry, { success: true, duplicate: false });
    assert.equal(inquiries.rows.length, 2);
    assert.equal(inquiries.rows[1][inquiries.rows[0].indexOf("Name")], "'=formula-like value");

    const duplicate = responseBody(receiver.doPost({
        parameter: {
            sheet: "Inquiries",
            name: "Duplicate",
            phone: "0000000000",
            submissionId: "legacy-inquiry-0001"
        }
    }));
    assert.deepEqual(duplicate, { success: true, duplicate: true });
    assert.equal(inquiries.rows.length, 2);

    const invalidSecret = responseBody(receiver.doPost({
        parameter: {
            sheet: "Inquiries",
            name: "Rejected applicant",
            phone: "0000000000",
            sharedSecret: "wrong-secret"
        }
    }));
    assert.deepEqual(invalidSecret, { success: false, errorCode: "invalid_submission" });
    assert.equal(inquiries.rows.length, 2);
});
