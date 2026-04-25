import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "Manasvi",
  tagline: "A secure, policy-governed AI agent operating fabric",
  favicon: "img/favicon.ico",

  url: "https://manasvi.dev",
  baseUrl: "/",

  organizationName: "manasvi",
  projectName: "manasvi",

  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn"
    }
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"]
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          path: "../../docs-public",
          routeBasePath: "/docs",
          showLastUpdateTime: false,
          showLastUpdateAuthor: false
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css"
        }
      } satisfies Preset.Options
    ]
  ],

  themeConfig: {
    image: "img/manasvi-social.png",
    colorMode: {
      defaultMode: "dark",
      disableSwitch: false,
      respectPrefersColorScheme: true
    },
    navbar: {
      title: "Manasvi",
      logo: {
        alt: "Manasvi Logo",
        src: "img/logo.svg",
        srcDark: "img/logo-dark.svg"
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "gettingStartedSidebar",
          position: "left",
          label: "Getting Started"
        },
        {
          type: "docSidebar",
          sidebarId: "conceptsSidebar",
          position: "left",
          label: "Concepts"
        },
        {
          type: "docSidebar",
          sidebarId: "architectureSidebar",
          position: "left",
          label: "Architecture"
        },
        {
          type: "docSidebar",
          sidebarId: "securitySidebar",
          position: "left",
          label: "Security"
        },
        {
          href: "https://github.com/nishchay7pixels/manasvi",
          label: "GitHub",
          position: "right"
        }
      ],
      hideOnScroll: false
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Getting Started", to: "/docs/getting-started/introduction" },
            { label: "Architecture", to: "/docs/architecture/overview" },
            { label: "Security", to: "/docs/security/philosophy" }
          ]
        },
        {
          title: "Learn",
          items: [
            { label: "Concepts", to: "/docs/concepts/agent-runtime" },
            { label: "Why Manasvi", to: "/docs/why-manasvi/not-just-a-chatbot" },
            { label: "FAQ", to: "/docs/faq" }
          ]
        },
        {
          title: "Community",
          items: [
            { label: "GitHub", href: "https://github.com/nishchay7pixels/manasvi" },
            { label: "Contributing", to: "/docs/contributing" }
          ]
        }
      ],
      copyright: `© ${new Date().getFullYear()} Manasvi. Built with purpose.`
    },
    prism: {
      theme: prismThemes.oneDark,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ["bash", "json", "typescript", "yaml", "docker"]
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true
      }
    }
  } satisfies Preset.ThemeConfig
};

export default config;
