// wawoff2 ships no types. Only decompress is used.
declare module "wawoff2" {
  const wawoff2: { decompress(woff2: Uint8Array): Promise<Uint8Array> };
  export default wawoff2;
}
