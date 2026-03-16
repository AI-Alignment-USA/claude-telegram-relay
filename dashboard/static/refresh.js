// Auto-refresh with "Last updated" indicator
(function() {
  var interval = parseInt(document.documentElement.dataset.refresh || '60', 10);
  var loadTime = Date.now();

  // Create indicator
  var el = document.createElement('div');
  el.className = 'refresh-indicator';
  el.textContent = 'Updated just now';
  document.body.appendChild(el);

  // Update the "X seconds ago" counter every second
  setInterval(function() {
    var ago = Math.floor((Date.now() - loadTime) / 1000);
    if (ago < 5) {
      el.textContent = 'Updated just now';
    } else if (ago < 60) {
      el.textContent = 'Updated ' + ago + 's ago';
    } else {
      el.textContent = 'Updated ' + Math.floor(ago / 60) + 'm ago';
    }
  }, 1000);

  // Auto-refresh the page
  setTimeout(function() {
    location.reload();
  }, interval * 1000);
})();
