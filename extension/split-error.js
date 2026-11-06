document.getElementById("message").textContent =
  new URL(location.href).searchParams.get("message") ?? "The selected tabs could not be split.";
