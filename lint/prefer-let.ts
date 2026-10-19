type VariableDeclaration = Deno.lint.VariableDeclaration;

const plugin: Deno.lint.Plugin = {
  name: "tty",
  rules: {
    "prefer-let": {
      create(context) {
        function isTopLevelScope(node: VariableDeclaration): boolean {
          // deno-lint-ignore no-explicit-any
          let current: any = node.parent;

          while (current) {
            switch (current.type) {
              case "FunctionDeclaration":
              case "FunctionExpression":
              case "ArrowFunctionExpression":
              case "BlockStatement":
                if (
                  current.type === "BlockStatement" &&
                  current.parent?.type === "Program"
                ) {
                  current = current.parent;
                  continue;
                }
                return false;

              case "Program":
                return true;
              default:
                current = current.parent;
            }
          }

          return false;
        }

        return {
          VariableDeclaration(node) {
            if (node.kind === "var") {
              context.report({
                message: "prefer `let` over `var` to declare value bindings",
                node,
              });
            } else if (node.kind === "const" && !isTopLevelScope(node)) {
              context.report({
                message: "`const` declaration outside top-level scope",
                node,
              });
            }
          },
        };
      },
    },
  },
};

export default plugin;
