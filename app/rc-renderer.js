async function bootApp() {
  const statusTitle = document.getElementById('rcStatusTitle');
  const statusText = document.getElementById('rcStatusText');
  const btnSelectFile = document.getElementById('btnSelectFile');
  const selectedFile = document.getElementById('selectedFile');

  try {
    const [info, health] = await Promise.all([
      window.rcApi.getAppInfo(),
      window.rcApi.healthCheck()
    ]);

    statusTitle.textContent = `${info.name} v${info.version}`;
    statusText.textContent = health.ok ? health.message : 'La app no respondió correctamente.';
  } catch (error) {
    statusTitle.textContent = 'Error de inicio';
    statusText.textContent = error.message;
  }

  btnSelectFile.addEventListener('click', async () => {
    const result = await window.rcApi.selectFiles({
      title: 'Seleccionar documento de prueba',
      multiple: false
    });

    if (result.canceled || result.files.length === 0) {
      selectedFile.textContent = 'Selección cancelada.';
      return;
    }

    selectedFile.textContent = result.files[0];
  });
}

window.addEventListener('DOMContentLoaded', bootApp);
