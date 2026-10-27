
document.addEventListener("DOMContentLoaded", () => {
  const styles = `
    #inquiry-popup-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0,0,0,.65);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    #inquiry-popup {
      position: relative;
      background: #fff;
      width: 100%;
      max-width: 420px;
      padding: 28px;
      border-radius: 16px;
      box-shadow: 0 15px 50px #0003;
      font-family: Arial, sans-serif;
    }

    #inquiry-popup h2 {
      margin: 0 25px 8px 0;
      color: #153d2b;
      font-size: 25px;
    }

    #inquiry-popup p {
      color: #666;
      margin-bottom: 20px;
    }

    #inquiry-popup .popup-close {
      position: absolute;
      top: 10px;
      right: 14px;
      border: 0;
      background: transparent;
      font-size: 28px;
      cursor: pointer;
    }

    #inquiry-popup input,
    #inquiry-popup select {
      box-sizing: border-box;
      width: 100%;
      padding: 13px;
      margin-bottom: 13px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 15px;
    }

    #inquiry-popup .popup-submit {
      width: 100%;
      padding: 14px;
      border: 0;
      border-radius: 8px;
      background: #153d2b;
      color: white;
      font-weight: bold;
      font-size: 16px;
      cursor: pointer;
    }

    #inquiry-popup .popup-submit:disabled {
      opacity: .65;
      cursor: wait;
    }

    #inquiry-popup-status {
      margin-top: 12px;
      font-size: 14px;
    }
  `;

  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>${styles}</style>`
  );

  document.body.insertAdjacentHTML("beforeend", `
    <div id="inquiry-popup-overlay">
      <section id="inquiry-popup"
        role="dialog" aria-modal="true"
        aria-labelledby="inquiry-popup-title">

        <button class="popup-close" type="button"
          aria-label="Close">&times;</button>

        <h2 id="inquiry-popup-title">Find Your Dream Property</h2>
        <p>Share your details and our team can help you.</p>

        <form id="inquiry-popup-form">
          <input name="name" type="text"
            placeholder="Your Full Name"
            autocomplete="name" required maxlength="100">

          <input name="phone" type="tel"
            placeholder="10-digit Mobile Number"
            autocomplete="tel" inputmode="numeric"
            pattern="[6-9][0-9]{9}"
            title="Enter a valid 10-digit Indian mobile number"
            required>

          <select name="budget" required>
            <option value="">Select Your Budget</option>
            <option>Below ₹20 Lakhs</option>
            <option>₹20–30 Lakhs</option>
            <option>₹30–50 Lakhs</option>
            <option>₹50 Lakhs–₹1 Crore</option>
            <option>Above ₹1 Crore</option>
          </select>

          <button class="popup-submit" type="submit">
            Submit Inquiry
          </button>

          <div id="inquiry-popup-status"
            role="status" aria-live="polite"></div>
        </form>
      </section>
    </div>
  `);

  const overlay = document.getElementById("inquiry-popup-overlay");
  const form = document.getElementById("inquiry-popup-form");
  const status = document.getElementById("inquiry-popup-status");
  const submit = form.querySelector(".popup-submit");

  const closePopup = () => {
    overlay.style.display = "none";
  };

  overlay.querySelector(".popup-close")
    .addEventListener("click", closePopup);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closePopup();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopup();
  });

  // Show on every page load after 2.5 seconds
  setTimeout(() => {
    overlay.style.display = "flex";
  }, 2500);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(form));
    const phone = data.phone.trim();

    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      status.textContent = "Please enter a valid mobile number.";
      return;
    }

    submit.disabled = true;
    status.textContent = "Submitting...";

    try {
      // Change this URL if your backend uses another domain.
      const response = await fetch("/api/inquiry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: data.name.trim(),
          phone,
          email: "",
          message: "Budget: " + data.budget,
          projectName: "Website Popup Inquiry"
        })
      });

      if (!response.ok) throw new Error("Submission failed");

      const result = await response.json();
      if (result.success !== true) throw new Error("Submission failed");

      status.textContent = "Thank you! Your inquiry has been submitted.";
      form.reset();

      setTimeout(closePopup, 1800);
    } catch (error) {
      status.textContent =
        "Could not submit. Please try again later.";
    } finally {
      submit.disabled = false;
    }
  });
});
