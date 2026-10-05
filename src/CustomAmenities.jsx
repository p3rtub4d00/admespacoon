import { useState } from 'react'
const key = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[\s-]+/g, '')
export default function CustomAmenities({ value = [], onChange, options = [], selected = [], onSelect, disabled = false }) {
  const [draft, setDraft] = useState(''), [error, setError] = useState('')
  function add() {
    const label = draft.trim().replace(/\s+/g, ' ')
    if (!label) return setError('Digite o nome da estrutura.')
    const fixed = options.find(option => key(option.label) === key(label))
    if (fixed) { if (!selected.includes(fixed.id)) onSelect([...selected, fixed.id]); setDraft(''); setError(''); return }
    if (value.some(item => key(item) === key(label))) return setError('Esta estrutura já foi adicionada.')
    if (value.length >= 20) return setError('Você pode adicionar até 20 outras estruturas.')
    onChange([...value, label]); setDraft(''); setError('')
  }
  return <div className="custom-amenities"><label>Adicionar outra estrutura<input value={draft} maxLength="60" disabled={disabled} placeholder="Ex.: som ambiente, forno a lenha" onChange={event => { setDraft(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!disabled) add() } }}/></label><button className="custom-amenity-add" type="button" disabled={disabled} onClick={add}>Adicionar</button><small>Digite e clique em Adicionar ou pressione Enter. Até 20 itens.</small>{error && <p role="alert">{error}</p>}<div className="custom-amenity-tags">{value.map(item => <span key={item}>{item}<button type="button" disabled={disabled} aria-label={'Remover estrutura ' + item} onClick={() => onChange(value.filter(other => other !== item))}>×</button></span>)}</div></div>
}
