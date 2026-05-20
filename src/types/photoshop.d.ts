declare module 'photoshop' {
  const app: any;
  const core: any;
  const action: any;
  const imaging: any;
  export { app, core, action, imaging };
}

declare module 'uxp' {
  const storage: {
    localFileSystem: any;
    secureStorage: any;
  };
  const shell: {
    openExternal: (url: string) => Promise<void>;
  };
  export { storage, shell };
}
