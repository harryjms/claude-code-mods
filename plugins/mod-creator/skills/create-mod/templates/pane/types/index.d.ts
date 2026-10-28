// Declares every value the mod keeps in $.state. The outer key is the plugin's
// name; `claude plugin validate` fails an atom whose key is not declared here.
declare module 'claude-code' {
  interface PluginState {
    'my-mod': {
      notes: string[]
    }
  }
}
