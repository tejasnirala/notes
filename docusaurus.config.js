// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import { themes as prismThemes } from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Tejas Nirala',
  tagline: 'Notes From Tejas Nirala',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://notes.tejasnirala.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'tejasnirala', // Usually your GitHub org/user name.
  projectName: 'notes', // Usually your repo name.

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'hi', 'de'],
    localeConfigs: {
      en: {
        label: 'English',
      },
      hi: {
        label: 'हिन्दी',
      },
      de: {
        label: 'Deutsch',
      },
    },
  },

  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          // editUrl:
          //   'https://github.com/tejasnirala/notes',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/tejasnirala/notes',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',

        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'devOps',
        path: 'notes/devOps',
        routeBasePath: 'devOps',
        sidebarPath: './sidebars/devOps.js',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'flask',
        path: 'notes/flask',
        routeBasePath: 'flask',
        sidebarPath: './sidebars/flask.js',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'java',
        path: 'notes/java',
        routeBasePath: 'java',
        sidebarPath: './sidebars/java.js',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'mongoDB',
        path: 'notes/mongoDB',
        routeBasePath: 'mongoDB',
        sidebarPath: './sidebars/mongoDB.js',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'nextJS',
        path: 'notes/nextJS',
        routeBasePath: 'nextJS',
        sidebarPath: './sidebars/nextJS.js',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'postgreSQL',
        path: 'notes/postgreSQL',
        routeBasePath: 'postgreSQL',
        sidebarPath: './sidebars/postgreSQL.js',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'systemDesign',
        path: 'notes/systemDesign',
        routeBasePath: 'systemDesign',
        sidebarPath: './sidebars/systemDesign.js',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'reactJS',
        path: 'notes/reactJS',
        routeBasePath: 'reactJS',
        sidebarPath: './sidebars/reactJS.js',
      },
    ],
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      ({
        hashed: true,
        language: ["en", "de"],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        docsRouteBasePath: [
          "/docs",
          "/devOps",
          "/flask",
          "/java",
          "/mongoDB",
          "/nextJS",
          "/postgreSQL",
          "/systemDesign",
          "/reactJS",
        ],
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Replace with your project's social card
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Notes',
        logo: {
          alt: 'Tejas Nirala | Notes Logo',
          src: 'img/TNLogo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'systemDesignSidebar',
            position: 'left',
            label: 'System Design',
            docsPluginId: 'systemDesign',
          },
          {
            type: 'docSidebar',
            sidebarId: 'devOpsSidebar',
            position: 'left',
            label: 'DevOps',
            docsPluginId: 'devOps',
          },
          {
            type: 'dropdown',
            label: 'Frontend',
            position: 'left',
            items: [
              {
                type: "docSidebar",
                sidebarId: "reactJSSidebar",
                label: "React",
                docsPluginId: 'reactJS',
              },
              {
                type: "docSidebar",
                sidebarId: "nextJSSidebar",
                label: "Nextjs",
                docsPluginId: 'nextJS',
              },
            ],
          },

          {
            type: 'dropdown',
            label: 'Backend',
            position: 'left',
            items: [
              {
                type: "docSidebar",
                sidebarId: "flaskSidebar",
                label: "Flask",
                docsPluginId: 'flask',
              },
              {
                type: "docSidebar",
                sidebarId: "javaSidebar",
                label: "Java",
                docsPluginId: 'java',
              },
            ],
          },

          {
            type: 'dropdown',
            label: 'Database',
            position: 'left',
            items: [
              {
                type: "docSidebar",
                sidebarId: "mongoDBSidebar",
                label: "MongoDB",
                docsPluginId: 'mongoDB',
              },
              {
                type: "docSidebar",
                sidebarId: "postgreSQLSidebar",
                label: "PostgreSQL",
                docsPluginId: 'postgreSQL',
              },
            ],
          },

          { to: '/blog', label: 'Blog', position: 'right' },

          {
            href: 'https://github.com/tejasnirala',
            position: 'right',
            className: 'header-github-link',
            'aria-label': 'GitHub repository',
          },
          {
            type: 'localeDropdown',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',

        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Tutorial',
                to: '/docs/intro',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'Blog',
                to: '/blog',
              },
              {
                label: 'GitHub',
                href: 'https://github.com/tejasnirala/notes',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} My Project, Inc. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.vsDark,
        additionalLanguages: [
          "bash",
          "javascript",
          "typescript",
          "jsx",
          "tsx",
          "python",
          "java",
          "json",
          "sql",
          "yaml",
          "diff",
          "docker",
        ],
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 5,
      },
    }),
};

export default config;
