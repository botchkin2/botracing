// react-dom has no types in this project (react-native-web brings it); the chase view needs one function.
declare module 'react-dom' {
  import type {ReactNode} from 'react';
  export function createPortal(children: ReactNode, container: Element): ReactNode;
}
