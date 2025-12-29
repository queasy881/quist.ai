import { app, BrowserWindow } from "electron"

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800
  })

  // 🔁 Load your Cloudflare URL here
  win.loadURL("https://quiz-contamination-kilometers-wall.trycloudflare.com")
}

app.whenReady().then(createWindow)

app.on("window-all-closed", () => {
  app.quit()
})
