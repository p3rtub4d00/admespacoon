import mongoose from 'mongoose'

const TARGET_URI = String(process.env.MONGODB_URI || '').trim()
const BACKUP_URI = String(process.env.BACKUP_MONGODB_URI || '').trim()
const SNAPSHOT_ID = String(process.env.BACKUP_SNAPSHOT_ID || '').trim()
const SOURCE_ID = String((process.env.BACKUP_SOURCE_ID || 'clubeon-master')).trim()
const CONFIRM = String(process.env.CONFIRM_RESTORE || '').trim()

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!TARGET_URI) fail('MONGODB_URI não configurado.')
if (!BACKUP_URI) fail('BACKUP_MONGODB_URI não configurado.')
if (!SNAPSHOT_ID) fail('BACKUP_SNAPSHOT_ID não configurado.')
if (CONFIRM !== 'RESTORE') fail('Defina CONFIRM_RESTORE=RESTORE para confirmar a restauração.')
if (TARGET_URI === BACKUP_URI) fail('O banco de backup deve ser diferente do banco principal.')

let target
let backup

try {
  target = mongoose.createConnection(TARGET_URI, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    maxPoolSize: 3,
  })
  backup = mongoose.createConnection(BACKUP_URI, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    maxPoolSize: 3,
  })

  await Promise.all([target.asPromise(), backup.asPromise()])

  const snapshot = await backup.db
    .collection('clubeon_backup_snapshots')
    .findOne({
      sourceId: SOURCE_ID,
      snapshotId: SNAPSHOT_ID,
      status: 'completed',
    })

  if (!snapshot) fail('Snapshot concluído não encontrado para este SOURCE_ID.')

  console.log('Restaurando snapshot:', SNAPSHOT_ID)
  console.log('Origem:', SOURCE_ID)

  for (const info of snapshot.collections || []) {
    const name = info?.name
    if (!name || name.startsWith('system.')) continue

    const targetCollection = target.db.collection(name)
    await targetCollection.deleteMany({})

    const cursor = backup.db
      .collection('clubeon_backup_documents')
      .find({
        sourceId: SOURCE_ID,
        snapshotId: SNAPSHOT_ID,
        collection: name,
      })
      .sort({ _id: 1 })

    let batch = []
    let restored = 0

    for await (const item of cursor) {
      batch.push(item.document)
      if (batch.length >= 250) {
        await targetCollection.insertMany(batch, { ordered: false })
        restored += batch.length
        batch = []
      }
    }

    if (batch.length) {
      await targetCollection.insertMany(batch, { ordered: false })
      restored += batch.length
    }

    const indexes = Array.isArray(info.indexes)
      ? info.indexes.filter((index) => index?.name && index.name !== '_id_' && index?.key)
      : []

    if (indexes.length) {
      await targetCollection.createIndexes(indexes)
    }

    console.log(name + ': ' + restored + ' documento(s) restaurado(s)')
  }

  console.log('Restauração concluída com sucesso.')
} catch (error) {
  console.error('Falha na restauração:', error?.message || error)
  process.exitCode = 1
} finally {
  if (target) await target.close().catch(() => {})
  if (backup) await backup.close().catch(() => {})
}
