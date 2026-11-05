const INQUIRY_HEADERS = [
  "Date",
  "Name",
  "Phone",
  "Email",
  "Budget",
  "Subject",
  "Message",
  "Enquiry Type",
  "Project Name",
  "Source",
  "Status",
  "Submission ID"
];

const CAREER_HEADERS = [
  "Date",
  "Name",
  "Phone",
  "Email",
  "Address",
  "Qualification",
  "Experience",
  "Applied Position",
  "Resume URL",
  "Cover Letter",
  "Source",
  "Status",
  "Submission ID"
];

const HEADER_ALIASES = {
  "Date": ["date", "datetime", "timestamp", "submittedat", "submissiondate"],
  "Name": ["name", "fullname", "applicantname"],
  "Phone": ["phone", "phonenumber", "contactnumber", "mobile", "mobilenumber"],
  "Email": ["email", "emailaddress"],
  "Budget": ["budget"],
  "Subject": ["subject"],
  "Message": ["message", "inquiry", "enquiry", "comments"],
  "Enquiry Type": ["enquirytype", "inquirytype", "formtype"],
  "Project Name": ["projectname", "project"],
  "Source": ["source", "sourcepage", "page"],
  "Status": ["status"],
  "Address": ["address"],
  "Qualification": ["qualification"],
  "Experience": ["experience"],
  "Applied Position": ["appliedposition", "position", "jobtitle"],
  "Resume URL": ["resumeurl", "cvurl"],
  "Cover Letter": ["coverletter"],
  "Submission ID": ["submissionid", "submissionkey", "idempotencykey"]
};

function doPost(event) {
  let request;
  try {
    request = readIncomingRequest(event);
  } catch (error) {
    return jsonResponse({ success: false, errorCode: "invalid_request" });
  }

  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty("SPREADSHEET_ID") || "";
  if (!spreadsheetId) {
    return jsonResponse({ success: false, errorCode: "configuration_missing" });
  }

  const expectedSecret = properties.getProperty("SHARED_SECRET") || "";
  if (request.mode === "json" &&
      (!expectedSecret ||
       !constantTimeEquals(request.body.sharedSecret, expectedSecret))) {
    return jsonResponse({ success: false, errorCode: "unauthorized" });
  }

  let submission;
  try {
    submission = request.mode === "json"
      ? validateJsonSubmission(request.body)
      : validateLegacyParameters(request.parameters, expectedSecret);
  } catch (error) {
    return jsonResponse({ success: false, errorCode: "invalid_submission" });
  }

  try {
    return processSubmission(spreadsheetId, submission);
  } catch (error) {
    return jsonResponse({ success: false, errorCode: "spreadsheet_write_failed" });
  }
}

function readIncomingRequest(event) {
  const postData = event && event.postData;
  const contentType = postData && typeof postData.type === "string"
    ? postData.type.toLowerCase()
    : "";
  if (contentType.includes("application/json")) {
    let body;
    try {
      body = JSON.parse(postData.contents);
    } catch (error) {
      throw new Error("Invalid JSON request.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Invalid JSON request.");
    }
    return { mode: "json", body };
  }
  return {
    mode: "parameters",
    parameters: event && event.parameter ? event.parameter : {}
  };
}

function validateJsonSubmission(body) {
  if (!["inquiry", "career"].includes(body.type) ||
      typeof body.submissionId !== "string" ||
      !/^[A-Za-z0-9:_-]{1,100}$/.test(body.submissionId) ||
      !body.record || typeof body.record !== "object" || Array.isArray(body.record)) {
    throw new Error("Invalid submission.");
  }
  return {
    type: body.type,
    submissionId: body.submissionId,
    record: validateRecord(body.record, body.type)
  };
}

function validateLegacyParameters(parameters, expectedSecret) {
  const providedSecret = parameterValue(parameters, ["sharedSecret"]);
  if (providedSecret &&
      (!expectedSecret || !constantTimeEquals(providedSecret, expectedSecret))) {
    throw new Error("Unauthorized legacy request.");
  }
  const sheet = parameterValue(parameters, ["sheet"]);
  const type = sheet === "Careers"
    ? "career"
    : ["Inquiries", "Enquiries"].includes(sheet)
      ? "inquiry"
      : "";
  if (!type) throw new Error("Unsupported sheet.");

  const record = {
    date: parameterValue(parameters, ["date", "timestamp"]),
    name: parameterValue(parameters, ["name"]),
    phone: parameterValue(parameters, ["phone", "phoneNumber", "mobile"]),
    email: parameterValue(parameters, ["email"]),
    budget: parameterValue(parameters, ["budget"]),
    subject: parameterValue(parameters, ["subject"]),
    message: parameterValue(parameters, ["message"]),
    enquiryType: parameterValue(parameters, ["enquiryType", "inquiryType", "formType"]),
    projectName: parameterValue(parameters, ["projectName", "project"]),
    source: parameterValue(parameters, ["source", "sourcePage"]),
    status: parameterValue(parameters, ["status"]),
    address: parameterValue(parameters, ["address"]),
    qualification: parameterValue(parameters, ["qualification"]),
    experience: parameterValue(parameters, ["experience"]),
    appliedPosition: parameterValue(parameters, ["appliedPosition", "position"]),
    resumeUrl: parameterValue(parameters, ["resumeUrl"]),
    coverLetter: parameterValue(parameters, ["coverLetter"])
  };
  const submissionId = parameterValue(parameters, ["submissionId", "Submission ID"]);
  if (submissionId && !/^[A-Za-z0-9:_-]{1,100}$/.test(submissionId)) {
    throw new Error("Invalid submission ID.");
  }
  return {
    type,
    submissionId,
    record: validateRecord(record, type)
  };
}

function validateRecord(record, type) {
  const fields = [
    "date", "name", "phone", "email", "budget", "subject", "message",
    "enquiryType", "projectName", "source", "status", "address",
    "qualification", "experience", "appliedPosition", "resumeUrl", "coverLetter"
  ];
  const clean = {};
  fields.forEach(field => {
    const value = record[field] == null ? "" : record[field];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error("Invalid record field.");
    }
    const text = String(value).trim();
    if (text.length > 5000) throw new Error("Record field too long.");
    clean[field] = text;
  });
  if (!clean.name || !clean.phone ||
      (type === "career" && (!clean.email || !clean.appliedPosition))) {
    throw new Error("Required fields are missing.");
  }
  if (!clean.date) clean.date = new Date().toISOString();
  if (!clean.status) clean.status = "new";
  if (!clean.source) clean.source = type === "career" ? "/career" : "/";
  return clean;
}

function parameterValue(parameters, names) {
  for (const name of names) {
    const value = parameters[name];
    if (typeof value === "string") return value.trim();
  }
  return "";
}

function processSubmission(spreadsheetId, submission) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheetName = submission.type === "career" ? "Careers" : "Inquiries";
    const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
    const headers = ensureHeaders(
      sheet,
      submission.type === "career" ? CAREER_HEADERS : INQUIRY_HEADERS
    );
    const submissionColumn = findHeaderColumn(headers, "Submission ID");
    if (submission.submissionId && submissionColumn > 0) {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const ids = sheet.getRange(2, submissionColumn, lastRow - 1, 1).getDisplayValues();
        if (ids.some(row => row[0].trim() === submission.submissionId)) {
          return jsonResponse({ success: true, duplicate: true });
        }
      }
    }

    const values = headers.map(header => {
      const canonical = canonicalHeader(header);
      if (canonical === "Submission ID") return safeCellValue(submission.submissionId);
      return safeCellValue(submission.record[recordField(canonical)]);
    });
    sheet.appendRow(values);
    return jsonResponse({ success: true, duplicate: false });
  } finally {
    lock.releaseLock();
  }
}

function ensureHeaders(sheet, requiredHeaders) {
  const lastColumn = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (!lastRow && !lastColumn) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return requiredHeaders;
  }
  if (!lastColumn) throw new Error("The existing sheet has data but no header row.");

  const existing = sheet.getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(value => value.trim());
  if (!existing.some(Boolean)) {
    throw new Error("The existing sheet has data but no header row.");
  }
  const known = new Set(existing.map(canonicalHeader).filter(Boolean));
  const missing = requiredHeaders.filter(header => !known.has(header));
  if (missing.length) {
    sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
    existing.push(...missing);
  }
  return existing;
}

function canonicalHeader(header) {
  const normalized = normalizeHeader(header);
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return canonical;
  }
  return "";
}

function normalizeHeader(header) {
  return String(header || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeaderColumn(headers, canonical) {
  const index = headers.findIndex(header => canonicalHeader(header) === canonical);
  return index < 0 ? 0 : index + 1;
}

function recordField(header) {
  return {
    "Date": "date",
    "Name": "name",
    "Phone": "phone",
    "Email": "email",
    "Budget": "budget",
    "Subject": "subject",
    "Message": "message",
    "Enquiry Type": "enquiryType",
    "Project Name": "projectName",
    "Source": "source",
    "Status": "status",
    "Address": "address",
    "Qualification": "qualification",
    "Experience": "experience",
    "Applied Position": "appliedPosition",
    "Resume URL": "resumeUrl",
    "Cover Letter": "coverLetter"
  }[header];
}

function safeCellValue(value) {
  const text = value == null ? "" : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function constantTimeEquals(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  let difference = actual.length ^ expected.length;
  const length = Math.max(actual.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
