import { navigate } from '../../router'
import { BrandMark } from './Icons'

export function Brand() {
  return (
    <a
      className="brand"
      href="/"
      onClick={(e) => {
        e.preventDefault()
        navigate('/')
      }}
    >
      <BrandMark />
      <span>EchoRoom</span>
    </a>
  )
}
