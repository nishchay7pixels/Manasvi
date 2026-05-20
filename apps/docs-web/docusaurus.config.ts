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

  plugins: [
    // webpackbar@6 passes options (name, color, reporters, reporter) that the
    // current webpack version rejects as unknown. Remove it from the plugin
    // list before webpack validates so the dev server and build can proceed.
    function webpackbarCompatPlugin() {
      return {
        name: "webpackbar-compat",
        configureWebpack(config: { plugins?: { constructor?: { name?: string } }[] }) {
          if (Array.isArray(config.plugins)) {
            config.plugins = config.plugins.filter(
              (p) => p?.constructor?.name !== "WebpackBarPlugin"
            );
          }
          return {};
        }
      };
    }
  ],

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
      title: "",
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
          label: "Docs"
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
          to: "/docs/tools/overview",
          position: "left",
          label: "Tools"
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
          title: "Get Started",
          items: [
            { label: "15-min Quickstart", to: "/docs/getting-started/quickstart" },
            { label: "Install", to: "/docs/getting-started/install" },
            { label: "Connect Ollama", to: "/docs/setup/connect-ollama" },
            { label: "Connect Claude", to: "/docs/setup/connect-claude" },
            { label: "Connect Telegram", to: "/docs/setup/connect-telegram" }
          ]
        },
        {
          title: "Learn",
          items: [
            { label: "Core Concepts", to: "/docs/concepts/agent-runtime" },
            { label: "Architecture", to: "/docs/architecture/overview" },
            { label: "Security", to: "/docs/security/philosophy" },
            { label: "Why Manasvi", to: "/docs/why-manasvi/not-just-a-chatbot" }
          ]
        },
        {
          title: "Tools",
          items: [
            { label: "Tools Overview", to: "/docs/tools/overview" },
            { label: "Default Tool Sets", to: "/docs/tools/default-sets" },
            { label: "Demo Flows", to: "/docs/tools/demo-flows" },
            { label: "Invocation Reference", to: "/docs/tools/tool-invocation-reference" }
          ]
        },
        {
          title: "Reference",
          items: [
            { label: "CLI Reference", to: "/docs/reference/cli" },
            { label: "FAQ", to: "/docs/faq" },
            { label: "Contributing", to: "/docs/contributing" },
            { label: "GitHub", href: "https://github.com/nishchay7pixels/manasvi" }
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
