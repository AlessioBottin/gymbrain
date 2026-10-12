import { saveRecord } from './store'
import { newTarget, type Exercise, type Prescription, type LocalRecord } from '../../shared/domain'
export async function createStarter(owner: string) {
  const exercises: Exercise[] = [
    {
      name: 'Pull-up',
      description: 'Trazione alla sbarra.',
      notes: 'Scapole attive.',
      exerciseType: 'bodyweight',
      variants: [],
      videoUrl: '',
      videoPath: '',
    },
    {
      name: 'Dip alle parallele',
      description: 'Spinta alle parallele.',
      notes: 'Mantieni il controllo.',
      exerciseType: 'bodyweight',
      variants: [],
      videoUrl: '',
      videoPath: '',
    },
    {
      name: 'Rematore agli anelli',
      description: 'Trazione orizzontale.',
      notes: 'Corpo in linea.',
      exerciseType: 'bodyweight',
      variants: [],
      videoUrl: '',
      videoPath: '',
    },
    {
      name: 'Squat',
      description: 'Accosciata con bilanciere.',
      notes: 'Movimento controllato.',
      exerciseType: 'weights',
      variants: [],
      videoUrl: '',
      videoPath: '',
    },
  ]
  const rows: LocalRecord[] = []
  for (const e of exercises) rows.push(await saveRecord(owner, 'exercise', e))
  const cycle = await saveRecord(owner, 'cycle', {
    name: 'Forza, sotto controllo.',
    notes: 'Un allenamento alla volta.',
    start: new Date().toISOString().slice(0, 10),
    weeks: 6,
  })
  const plan = await saveRecord(
    owner,
    'plan',
    { name: 'Accumulo', notes: 'Esecuzione controllata e progressione graduale.', order: 0 },
    { parentId: cycle.id },
  )
  for (const [i, ids] of [
    [0, 1, 2],
    [3, 2],
    [0, 1, 3],
  ].entries()) {
    const prescriptions: Prescription[] = ids.map((id) => ({
      id: crypto.randomUUID(),
      exerciseId: rows[id]!.id,
      name: exercises[id]!.name,
      mode: id === 0 ? (i === 2 ? 'band' : 'weighted') : id === 3 ? 'external' : 'bodyweight',
      exerciseType: exercises[id]!.exerciseType,
      variant: null,
      assistance: [],
      notes:
        i === 0
          ? 'Salita esplosiva, discesa controllata.'
          : 'Mantieni il controllo durante il movimento.',
      band: id === 0 && i === 2 ? 'Assistenza media' : '',
      alternatives: id === 0 ? [rows[2]!.id] : [],
      sets: Array.from({ length: 3 }, () => ({
        ...newTarget(),
        reps: id === 0 ? 6 : 8,
        load: id === 0 && i === 0 ? 10 : id === 3 ? 60 : null,
      })),
    }))
    await saveRecord(
      owner,
      'workout',
      {
        name: ['Upper body', 'Lower body', 'Full body'][i]!,
        notes: 'Personalizza le prescrizioni secondo la tua scheda.',
        order: i,
        exercises: prescriptions,
      },
      { parentId: plan.id },
    )
  }
  return { cycle: cycle.id, plan: plan.id }
}
