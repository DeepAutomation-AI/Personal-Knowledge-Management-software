import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function nav(page: Page, label: string) {
  const button = page
    .locator('.sidebar')
    .getByRole('button', { name: new RegExp('^' + label + '(?: \\d+)?$') });
  if (
    (await page.getByRole('button', { name: 'Abrir navegación' }).isVisible()) &&
    !(await page
      .locator('.sidebar')
      .evaluate((element) => element.classList.contains('sidebar-open')))
  )
    await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await button.click();
}
async function create(page: Page, title: string, content: string) {
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Título de la nota', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Crear nota', exact: true }).click();
  await page.getByLabel('Contenido Markdown de la nota').fill(content);
  await expect(page.locator('.save-state')).toHaveText('Guardado');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tu conocimiento, conectado.' })).toBeVisible();
});

test('writes Markdown, persists across reload, and searches without accents', async ({ page }) => {
  await create(
    page,
    'Reflexión persistente',
    '## Mi idea\n\nUn café y una conexión. #memoria\n\n- [ ] Revisar evidencia',
  );
  await page.getByRole('button', { name: 'Leer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mi idea' })).toBeVisible();
  await expect(page.getByText('Un café y una conexión.', { exact: false })).toBeVisible();
  await page.reload();
  await page.getByLabel('Filtrar biblioteca').fill('reflexion');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await page.getByRole('heading', { name: 'Reflexión persistente' }).click();
  await page.getByRole('button', { name: 'Escribir', exact: true }).click();
  await expect(page.getByLabel('Contenido Markdown de la nota')).toHaveValue(
    /Un café y una conexión/,
  );
});

test('toggles a Markdown task at the original line and connects real notes', async ({ page }) => {
  await create(
    page,
    'Origen de prueba',
    '## Ideas\n\n- [ ] Conectar ideas\n\n[[Destino de prueba|Abrir mi destino]]',
  );
  await page.getByRole('button', { name: 'Leer', exact: true }).click();
  await page.locator('.markdown-body input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Escribir', exact: true }).click();
  await expect(page.getByLabel('Contenido Markdown de la nota')).toHaveValue(
    /- \[x\] Conectar ideas/,
  );
  await create(page, 'Destino de prueba', 'El destino de una conexión.');
  if (await page.locator('.context-panel').isVisible())
    await expect(
      page.locator('.context-panel').getByRole('button', { name: 'Origen de prueba' }),
    ).toBeVisible();
  await nav(page, 'Biblioteca');
  await page.getByLabel('Filtrar biblioteca').fill('Origen de prueba');
  await page.getByRole('heading', { name: 'Origen de prueba', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir mi destino', exact: true }).click();
  await expect(page.getByLabel('Título de la nota', { exact: true })).toHaveValue(
    'Destino de prueba',
  );
  await page.getByLabel('Título de la nota', { exact: true }).fill('Destino renombrado');
  await page.getByLabel('Título de la nota', { exact: true }).press('Enter');
  await expect(page.getByLabel('Título de la nota', { exact: true })).toHaveValue(
    'Destino renombrado',
  );
  await nav(page, 'Biblioteca');
  await page.getByLabel('Filtrar biblioteca').fill('Origen de prueba');
  await page.getByRole('heading', { name: 'Origen de prueba', exact: true }).click();
  await page.getByRole('button', { name: 'Escribir', exact: true }).click();
  await expect(page.getByLabel('Contenido Markdown de la nota')).toHaveValue(
    /\[\[Destino renombrado\|Abrir mi destino\]\]/,
  );
});

test('uses daily notes, folders, favorites, task aggregation, and trash restoration', async ({
  page,
}) => {
  await create(page, 'Nota recuperable', '- [ ] Pendiente verificable #prueba');
  await page.getByRole('button', { name: 'Añadir nota a favoritas' }).click();
  await nav(page, 'Tareas');
  const task = page.getByRole('checkbox', {
    name: 'Completar tarea: Pendiente verificable #prueba',
  });
  await task.click();
  await expect(task).not.toBeVisible();
  await page.getByRole('button', { name: 'Completadas', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Completar tarea: Pendiente verificable #prueba' }),
  ).toBeChecked();
  await nav(page, 'Biblioteca');
  await page.getByRole('tab', { name: 'Favoritas' }).click();
  await expect(page.getByRole('heading', { name: 'Nota recuperable' })).toBeVisible();
  await page.getByRole('heading', { name: 'Nota recuperable' }).click();
  await page.getByRole('button', { name: 'Mover nota a la papelera' }).click();
  await nav(page, 'Papelera');
  await page
    .locator('.trash-row')
    .filter({ hasText: 'Nota recuperable' })
    .getByRole('button', { name: 'Restaurar' })
    .click();
  await nav(page, 'Biblioteca');
  await page.getByLabel('Filtrar biblioteca').fill('Nota recuperable');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await nav(page, 'Notas diarias');
  await expect(page.getByLabel('Título de la nota', { exact: true })).toHaveValue(
    /^\d{4}-\d{2}-\d{2}$/,
  );
  await expect(page.getByLabel('Contenido Markdown de la nota')).toHaveValue(/Hoy quiero…/);
});

test('imports plain Markdown, exports a backup, and restores an IndexedDB snapshot', async ({
  page,
}) => {
  await page.getByLabel('Archivos a importar').setInputFiles({
    name: 'Nota importada.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('## Contenido importado\n\nTexto íntegro.'),
  });
  await expect(page.getByRole('heading', { name: 'Nota importada', exact: true })).toBeVisible();
  await nav(page, 'Ajustes');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Copia completa', exact: false }).click();
  const backup = await downloaded;
  expect(backup.suggestedFilename()).toMatch(/^atlas-.*\.json$/);
  await page.getByRole('button', { name: 'Crear instantánea' }).click();
  await expect(page.locator('.snapshot-list > div')).toHaveCount(1);
  await create(page, 'Después de la instantánea', 'Esta nota se guarda después de crear la copia.');
  await nav(page, 'Ajustes');
  await page.locator('.snapshot-list').getByRole('button', { name: 'Restaurar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restaurar', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Instantánea restaurada' }),
  ).toBeVisible();
  await nav(page, 'Biblioteca');
  await page.getByLabel('Filtrar biblioteca').fill('Después de la instantánea');
  await expect(page.locator('.note-card')).toHaveCount(0);
  await page.getByLabel('Filtrar biblioteca').fill('Nota importada');
  await expect(page.locator('.note-card')).toHaveCount(1);
});

test('graph navigation, command search, theme, and responsive layout work', async ({ page }) => {
  await nav(page, 'Grafo de conocimiento');
  await expect(page.locator('.graph-node')).toHaveCount(10);
  await page.locator('.graph-node').first().click();
  await expect(page.getByLabel('Título de la nota', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByLabel('Buscar notas').fill('zzzz-no-existe');
  await expect(page.getByText('No hay notas que coincidan. Prueba otra búsqueda.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  if (await page.getByRole('button', { name: 'Activar tema oscuro' }).isVisible())
    await page.getByRole('button', { name: 'Activar tema oscuro' }).click();
  else {
    await nav(page, 'Ajustes');
    await page.getByRole('button', { name: 'Oscuro', exact: true }).click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('production shell and saved notes remain available offline', async ({ page, context }) => {
  await create(page, 'Idea sin conexión', 'Esta idea sobrevive sin red.');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tu conocimiento, conectado.' })).toBeVisible();
  await page.getByLabel('Filtrar biblioteca').fill('Idea sin conexión');
  await page.getByRole('heading', { name: 'Idea sin conexión' }).click();
  await expect(page.locator('.markdown-body')).toContainText('Esta idea sobrevive sin red.');
  await nav(page, 'Ajustes');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar Markdown', exact: false }).click();
  expect((await download).suggestedFilename()).toMatch(/^atlas-markdown-.*\.zip$/);
});

test('main library and note editor have no automatic WCAG A or AA violations', async ({ page }) => {
  const library = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(library.violations).toEqual([]);
  await create(
    page,
    'Nota accesible',
    '## Encabezado\n\nTexto de prueba y una [[Conexión]].\n\n- [ ] Una tarea',
  );
  await page.getByRole('button', { name: 'Leer', exact: true }).click();
  const note = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(note.violations).toEqual([]);
});
