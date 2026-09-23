// Vite's ?raw imports give a file's text as a string.
declare module '*?raw' {
  const text: string;
  export default text;
}
