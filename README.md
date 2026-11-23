# Assays

Your Abbott Alinity IFUs in one page: find an IFU by name or abbreviation, see its key numbers at a glance, search inside all of them, and jump to Mayo Clinic Labs or the SGH test directory.

Live page: https://3dfung-ai.github.io/assays/

## How it works

- This public page holds **code only**. No IFU text, numbers or PDFs are in this repository.
- Your IFU library (`assays-library.json`) and PDFs stay in your Google Drive. The page reads them through your own Apps Script web app, which answers only requests carrying your private key.
- The library and any PDFs you open are saved in the browser (IndexedDB), so Assays works offline after the first load.
- Pins and notes sync between your PCs through the same script, into `My Drive/00_Apps/Assays/assays-sync.json`, with daily backups.

## Files in Drive

| Where | What |
|---|---|
| `00_Apps/Assays/assays-library.json` | Key numbers and page text for every IFU (built by Claude from the PDFs) |
| `00_Apps/Assays/assays-sync.json` | Your pins and notes |
| `00_Apps/Assays/backups/` | Daily backups of pins and notes (newest 40) |
| `00_Apps/Assays/sgh-index.json` | SGH test names and links, refreshed weekly |
| `OneDrive Import/1. Lab/Admin/IFU/Abbott Alinity/` | The IFU PDFs themselves |

## Adding or replacing an IFU

Drop the PDF into the Abbott Alinity folder. Assays lists it straight away under **Not indexed yet** (open only). Ask Claude to rebuild the library to make it searchable with key numbers.

Built 2026-11-23.
