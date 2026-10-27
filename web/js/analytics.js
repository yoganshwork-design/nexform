// Analytics: intake, burn and weight trend charts from server history.
(function () {
  const A = {};
  let range = 7, charts = {}, history = null;

  async function fetchHistory() {
    const res = await Api.requestJson(`${Api.API}?action=history&days=${range}`);
    history = res.days || [];
  }

  const baseOpts = (stacked) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#33505f', font: { family: 'Space Grotesk', weight: '600' } } } },
    scales: {
      x: { stacked, grid: { display: false }, ticks: { color: '#6b8798', font: { size: 10 } } },
      y: { stacked, grid: { color: 'rgba(10,111,150,.08)' }, ticks: { color: '#6b8798' } },
    },
  });

  function destroy() { Object.values(charts).forEach(c => c?.destroy()); charts = {}; }

  A.render = async function () {
    try { await fetchHistory(); } catch (e) { return; }
    destroy();
    const labels = history.map(d => new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

    const c1 = document.getElementById('chart-nutrition');
    if (c1) charts.n = new Chart(c1, {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Protein (g)', data: history.map(d => d.protein), backgroundColor: '#2563eb', borderRadius: 6 },
        { label: 'Calories (kcal)', data: history.map(d => d.calories), backgroundColor: 'rgba(128,223,255,.75)', borderRadius: 6, yAxisID: 'y1' },
      ]},
      options: { ...baseOpts(false), scales: { ...baseOpts(false).scales, y1: { position: 'right', grid: { display: false }, ticks: { color: '#6b8798' } } } },
    });

    const c2 = document.getElementById('chart-burn');
    if (c2) charts.b = new Chart(c2, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Burned (kcal)', data: history.map(d => d.burned), backgroundColor: 'rgba(245,158,11,.8)', borderRadius: 6 }] },
      options: baseOpts(false),
    });

    const c3 = document.getElementById('chart-weight');
    if (c3) charts.w = new Chart(c3, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Weight (kg)', data: history.map(d => d.weight), borderColor: '#0a6f96', backgroundColor: 'rgba(128,223,255,.25)', fill: true, tension: 0.4, pointBackgroundColor: '#ffff33', pointBorderColor: '#0a6f96', pointRadius: 4 }] },
      options: baseOpts(false),
    });
  };

  A.init = function () {
    document.querySelectorAll('#range-btns [data-range]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('#range-btns [data-range]').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); range = +b.dataset.range; A.render();
      };
    });
  };

  window.Analytics = A;
})();
