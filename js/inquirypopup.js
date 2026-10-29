
document.addEventListener("DOMContentLoaded", () => {
  // Backend API URL
  const API_URL = "https://raj-real-estate.onrender.com/api/inquiry";
  // Add popup styles
  const styles = `
    #inquiry-popup-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0, 0, 0, 0.45);
      display: none;
      justify-content: center;
      align-items: center;
      padding: 16px;
      box-sizing: border-box;
    }

    #inquiry-popup {
      position: relative;
      width: 100%;
      max-width: 400px;
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
      box-sizing: border-box;
      background: #fff;
      color: #171717;
      padding: 24px 22px;
      font-family: Arial, Helvetica, sans-serif;
      box-shadow: 0 12px 45px rgba(0,0,0,.18);
      border-radius: 4px;
      animation: enquiryEnter .3s ease-out;
    }

    @keyframes enquiryEnter {
      from {
        opacity: 0;
        transform: translateY(12px) scale(.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    #inquiry-popup .popup-close {
      position: absolute;
      top: 7px;
      right: 12px;
      border: 0;
      background: transparent;
      color: #555;
      font-size: 27px;
      cursor: pointer;
      padding: 2px 4px;
    }

    #inquiry-popup h2 {
      text-align: center;
      font-size: 23px;
      margin: 0 24px 6px;
      font-weight: 700;
    }

    #inquiry-popup .popup-subtitle {
      text-align: center;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 35px;
      color: #222;
    }

    #inquiry-popup .popup-field {
      display: block;
      width: 100%;
      height: 49px;
      box-sizing: border-box;
      padding: 0 15px;
      margin-bottom: 10px;
      border: 1px solid #d1d1d1;
      border-radius: 6px;
      background: #fff;
      font-size: 14px;
      color: #222;
      outline-color: #555;
    }

    #inquiry-popup .popup-field::placeholder {
      color: #888;
    }

    #inquiry-popup .popup-submit {
      display: block;
      width: 100%;
      min-height: 46px;
      border: 0;
      border-radius: 5px;
      background: #202122;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 1px;
    }

    #inquiry-popup .popup-submit:hover {
      background: #383838;
    }

    #inquiry-popup .popup-submit:disabled {
      opacity: .65;
      cursor: wait;
    }

    #inquiry-popup .popup-status {
      font-size: 13px;
      line-height: 1.5;
      margin-top: 12px;
    }

    #inquiry-popup .popup-note {
      font-size: 11px;
      color: #666;
      text-align: center;
      margin-top: 12px;
    }

    @media (max-width: 480px) {
      #inquiry-popup-overlay {
        padding: 12px;
      }

      #inquiry-popup {
        max-width: 100%;
        padding: 24px 22px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #inquiry-popup {
        animation: none;
      }
    }
  `;

  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>${styles}</style>`
  );

  // Add popup HTML
  document.body.insertAdjacentHTML("beforeend", `
    <div id="inquiry-popup-overlay">
      <section id="inquiry-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inquiry-popup-title">

        <button class="popup-close"
          type="button"
          aria-label="Close enquiry form">&times;</button>

        <h2 id="inquiry-popup-title">Send Enquiry</h2>

        <p class="popup-subtitle">
          Submit the details below and our experts will get
          in touch with you.
        </p>

        <form id="inquiry-popup-form">
          <input
            class="popup-field"
            name="name"
            type="text"
            placeholder="First name"
            autocomplete="name"
            maxlength="100"
            required
          >

          <input
            class="popup-field"
            name="phone"
            type="tel"
            placeholder="10-digit Mobile Number"
            autocomplete="tel"
            inputmode="numeric"
            pattern="[6-9][0-9]{9}"
            maxlength="10"
            title="Enter a valid 10-digit Indian mobile number"
            required
          >



<select
  class="popup-field"
  name="budget"
  required
>
  <option value="" disabled selected>
    Select Your Budget
  </option>
  <option value="20-40 Lakhs">20–40 Lakhs</option>
  <option value="40-60 Lakhs">40–60 Lakhs</option>
  <option value="60-80 Lakhs">60–80 Lakhs</option>
  <option value="80 Lakhs and Above">80 Lakhs and Above</option>
</select>

          <button class="popup-submit" type="submit">
            Submit
          </button>

          <div class="popup-status"
            id="inquiry-popup-status"
            role="status"
            aria-live="polite"></div>

          <div class="popup-note">
            Your details will be used to respond to your enquiry.
          </div>
        </form>
      </section>
    </div>
  `);

  const overlay = document.getElementById(
    "inquiry-popup-overlay"
  );

  const form = document.getElementById(
    "inquiry-popup-form"
  );

  const status = document.getElementById(
    "inquiry-popup-status"
  );

  const submit = form.querySelector(".popup-submit");
  const closeButton = overlay.querySelector(".popup-close");

  let previousFocus = null;

  function openPopup() {
    previousFocus = document.activeElement;
    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    closeButton.focus();
  }

  function closePopup() {
    overlay.style.display = "none";
    document.body.style.overflow = "";

    if (previousFocus && previousFocus.focus) {
      previousFocus.focus();
    }
  }

  // Close button
  closeButton.addEventListener("click", closePopup);

  // Close when clicking outside the form
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closePopup();
    }
  });

  // Close with Escape key
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      overlay.style.display === "flex"
    ) {
      closePopup();
    }
  });

  // Show popup 2 seconds after page load
  setTimeout(openPopup, 2000);

  // Submit inquiry to backend
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = Object.fromEntries(
      new FormData(form).entries()
    );

    const name = data.name.trim();
    const phone = data.phone.trim();
    const budget = data.budget.trim();

    if (!name || !budget) {
      status.textContent = "Please fill in all fields.";
      return;
    }

    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      status.textContent =
        "Please enter a valid 10-digit mobile number.";
      return;
    }

    submit.disabled = true;
    status.textContent = "Submitting your enquiry...";

try {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: name,
      phone: phone,
      email: "",
      message: "Budget: " + budget,
      projectName: "General Inquiry Form"
    })
  });

  const responseText = await response.text();

  console.log("HTTP status:", response.status);
  console.log("Server response:", responseText);

  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      "Invalid server response. HTTP " + response.status
    );
  }

  if (!response.ok || result.success !== true) {
    throw new Error(
      result.error || "Submission failed: " + response.status
    );
  }

  status.textContent =
    "Thank you! Your enquiry has been submitted.";

  form.reset();

  // Popup 2 minute baad close hoga
  setTimeout(closePopup, 2000);

} catch (error) {
  console.error("Inquiry error:", error);
  status.textContent = "Error: " + error.message;

} finally {
  submit.disabled = false;
}
  });
});
