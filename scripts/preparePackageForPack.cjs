const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const rootDir = path.resolve(__dirname, '..')
const packageJsonPath = path.join(rootDir, 'package.json')
const publishTemplatePath = path.join(rootDir, 'package.publish.json')
const packageBackupPath = path.join(rootDir, '.package.json.pack-backup')
const distIndexPath = path.join(rootDir, 'dist', 'index.html')

const command = process.argv[2]

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

const restorePackageJson = () => {
  if (!fs.existsSync(packageBackupPath)) return
  fs.copyFileSync(packageBackupPath, packageJsonPath)
  fs.rmSync(packageBackupPath)
}

if (command === 'prepack') {
  restorePackageJson()

  if (!fs.existsSync(distIndexPath)) {
    console.log('[pack] `dist/index.html` was not found. Running `pnpm build`...')
    execFileSync('pnpm', ['build'], {
      cwd: rootDir,
      stdio: 'inherit'
    })
  }

  const rootPackageJson = readJson(packageJsonPath)
  const publishTemplate = readJson(publishTemplatePath)

  writeJson(packageBackupPath, rootPackageJson)
  writeJson(packageJsonPath, {
    ...publishTemplate,
    version: rootPackageJson.version
  })
} else if (command === 'postpack') {
  restorePackageJson()
} else {
  throw new Error(`Unknown command: ${command}`)
}
