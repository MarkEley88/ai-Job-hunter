/* AI Job Hunter - free application workflow enhancements */
(() => {
  const TARGET_MIN = 120000;
  const originalCalculateFit = window.calculateFit;

  function salaryNumbers(value) {
    return String(value || '').match(/\d[\d,]*/g)?.map(v => Number(v.replace(/,/g, ''))) || [];
  }

  function salaryGate(job) {
    const nums = salaryNumbers(job.salary);
    if (!nums.length) return true;
    return Math.max(...nums) >= TARGET_MIN;
  }

  window.calculateFit = function(job) {
    const score = typeof originalCalculateFit === 'function' ? originalCalculateFit(job) : 0;
    if (!salaryGate(job)) return 0;
    return score;
  };
})();
