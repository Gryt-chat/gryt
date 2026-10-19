// Wrangler's text loader hands an imported .html file over as a string.
declare module "*.html" {
  const text: string;
  export default text;
}
