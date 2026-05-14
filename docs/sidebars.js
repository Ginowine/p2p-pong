// @ts-check

const sidebars = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: ['getting-started/setup', 'getting-started/create-project'],
    },
    {
      type: 'category',
      label: 'Backend',
      items: ['backend/index'],
    },
    {
      type: 'category',
      label: 'Frontend',
      items: ['frontend/app', 'frontend/physics', 'frontend/renderer'],
    },
  ],
};

export default sidebars;
