(() => {
  const jobList = document.querySelector('#job-list');
  if (!jobList) return;

  function getJobs() {
    try {
      return JSON.parse(localStorage.getItem('ai-job-hunter-jobs-v1')) || [];
    } catch {
      return [];
    }
  }

  function decorateDescriptions() {
    const jobs = getJobs();

    jobList.querySelectorAll('.job-card').forEach(card => {
      const title = card.querySelector('h3')?.textContent?.trim();
      const company = card.querySelector('.company')?.textContent?.trim();
      const details = card.querySelector('.job-description');
      const body = card.querySelector('.description-body');

      if (!details || !body || details.dataset.ready === 'true') return;

      const job = jobs.find(item =>
        (item.title || 'Untitled role') === title &&
        (item.company || 'Unknown company') === company
      );

      const description = job?.description?.trim();

      if (!description) {
        details.remove();
        return;
      }

      body.textContent = description;
      details.dataset.ready = 'true';
    });
  }

  const observer = new MutationObserver(decorateDescriptions);
  observer.observe(jobList, { childList: true, subtree: true });
  decorateDescriptions();
})();
