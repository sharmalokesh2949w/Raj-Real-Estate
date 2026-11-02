
document.addEventListener("DOMContentLoaded", () => {
  // Backend API URL
  const API_ROOT = (window.RAJ_API_BASE_URL || (["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? window.location.origin
    : "https://raj-real-estate.onrender.com")).replace(/\/$/, "");
  const API_URL = `${API_ROOT}/api/inquiry`;
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

        <div id="inquiry-popup-content">
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
            placeholder="Name"
            autocomplete="name"
            maxlength="100"
            required
          >

          <input
            class="popup-field"
            name="phone"
            type="tel"
            placeholder="Phone Number"
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
            aria-label="Select Your Budget">
            <option value="" selected disabled>Select Your Budget</option>
            <option value="₹20–40 Lakh">₹20–40 Lakh</option>
            <option value="₹40–60 Lakh">₹40–60 Lakh</option>
            <option value="₹60–80 Lakh">₹60–80 Lakh</option>
            <option value="₹80 Lakh and Above">₹80 Lakh and Above</option>
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
        </div>

        <div id="inquiry-popup-success" hidden>
          <h2 id="inquiry-popup-success-title" tabindex="-1">Thank You!</h2>
          <p class="popup-subtitle">Your enquiry has been submitted successfully. Our team will get in touch with you soon.</p>
          <button class="popup-submit" id="inquiry-popup-another" type="button">Send another enquiry</button>
        </div>
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

  const popup = document.getElementById("inquiry-popup");
  const content = document.getElementById("inquiry-popup-content");
  const success = document.getElementById("inquiry-popup-success");
  const anotherButton = document.getElementById("inquiry-popup-another");
  const submit = form.querySelector(".popup-submit");
  const closeButton = overlay.querySelector(".popup-close");

  let previousFocus = null;

  function openPopup() {
    if (overlay.style.display === "flex") return;
    if (form.dataset.submitting !== "true") resetPopup();
    previousFocus = document.activeElement;
    overlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    closeButton.focus();
  }

  function resetPopup() {
    form.reset();
    status.textContent = "";
    content.hidden = false;
    success.hidden = true;
    popup.setAttribute("aria-labelledby", "inquiry-popup-title");
  }

  function closePopup() {
    overlay.style.display = "none";
    document.body.style.overflow = "";

    if (previousFocus && previousFocus.focus) {
      previousFocus.focus();
    }
  }

  window.openInquiryPopup = openPopup;

  // Close button
  closeButton.addEventListener("click", closePopup);
  anotherButton.addEventListener("click", () => {
    resetPopup();
    form.querySelector("input[name='name']").focus();
  });

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
    if (form.dataset.submitting === "true") return;
    if (!form.reportValidity()) return;

    const data = Object.fromEntries(
      new FormData(form).entries()
    );

    const name = data.name.trim();
    const phone = data.phone.trim();
    const budget = data.budget.trim();

    if (!name || !budget || !phone) {
      status.textContent = "Please complete all required fields.";
      return;
    }

    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      status.textContent =
        "Please enter a valid 10-digit mobile number.";
      return;
    }

    submit.disabled = true;
    form.dataset.submitting = "true";
    status.textContent = "Submitting your enquiry...";

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          message: `Budget: ${budget}`,
          budget,
          projectName: "Website Popup Inquiry",
          sourceForm: "Homepage popup",
          sourcePage: window.location.pathname
        })
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
      }
      if (!response.ok || result.success !== true) {
        throw new Error(result.error || `The enquiry could not be saved (HTTP ${response.status}).`);
      }

      form.reset();
      content.hidden = true;
      success.hidden = false;
      popup.setAttribute("aria-labelledby", "inquiry-popup-success-title");
      document.getElementById("inquiry-popup-success-title").focus();
    } catch (error) {
      status.textContent = error instanceof TypeError
        ? "We could not reach the server. Check your connection and try again."
        : error.message;
    } finally {
      form.dataset.submitting = "false";
      submit.disabled = false;
    }
  });
});
