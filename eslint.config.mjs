import next from "eslint-config-next";

export default [
  ...next,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "viem", message: "This service must not be able to sign. See AGENTS.md." },
            { name: "ethers", message: "This service must not be able to sign. See AGENTS.md." },
            { name: "@base-org/account", message: "This service must not be able to sign. See AGENTS.md." },
          ],
        },
      ],
    },
  },
];
