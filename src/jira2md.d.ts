declare module "jira2md" {
  const j2m: {
    to_jira(markdown: string): string;
    to_markdown(jira: string): string;
  };
  export default j2m;
}
