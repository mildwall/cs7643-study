// Runs exercises with Pyodide in a worker. Kept outside the bundle because it imports from a CDN.
const VERSION = 'v314.0.7';

const loading = (async () => {
  postMessage({ type: 'status', text: 'Downloading Python (first run only)' });
  const { loadPyodide } = await import(`https://cdn.jsdelivr.net/pyodide/${VERSION}/full/pyodide.mjs`);
  const py = await loadPyodide({
    stdout: (text) => postMessage({ type: 'stdout', text }),
    stderr: (text) => postMessage({ type: 'stderr', text }),
  });
  postMessage({ type: 'status', text: 'Loading NumPy' });
  await py.loadPackage('numpy', { messageCallback: () => {} });
  return py;
})();

loading.then(
  () => postMessage({ type: 'ready' }),
  (e) => postMessage({ type: 'done', ok: false, error: `Python could not be loaded: ${e}` }),
);

onmessage = async ({ data }) => {
  if (data.type !== 'run') return;
  const py = await loading;
  try {
    // A real file gives the script __file__ and __name__ == "__main__", as on a normal machine.
    py.FS.writeFile(`/home/pyodide/${data.file}`, data.code);
    await py.runPythonAsync(`
import runpy, sys
sys.argv = [${JSON.stringify(data.file)}]
try:
    runpy.run_path(${JSON.stringify(`/home/pyodide/${data.file}`)}, run_name="__main__")
finally:
    sys.stdout.flush()
`);
    postMessage({ type: 'done', ok: true });
  } catch (e) {
    // Trim the frames that belong to this runner, so the learner sees their own traceback.
    const text = String(e.message ?? e);
    const mine = text.lastIndexOf(`File "/home/pyodide/${data.file}"`);
    postMessage({ type: 'done', ok: false, error: mine > 0 ? `Traceback:\n  ${text.slice(mine)}` : text });
  }
};
