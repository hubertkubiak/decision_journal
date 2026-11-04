// Optional progressive enhancement. Everything works without this file.

// Show the exact value next to the confidence slider.
for (const output of document.querySelectorAll('.confidence-input__output')) {
  const slider = document.getElementById(output.htmlFor.value);
  if (!slider) continue;
  const update = () => {
    output.textContent = `${slider.value}%`;
  };
  slider.addEventListener('input', update);
  update();
  output.hidden = false;
}

// Submit the filter form when a filter changes.
for (const form of document.querySelectorAll('form[data-auto-submit]')) {
  form.addEventListener('change', () => form.requestSubmit());
}
