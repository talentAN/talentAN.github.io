import React,{useEffect, useRef} from 'react';
import { Layout, Button } from 'antd';
import { graphql } from 'gatsby';
import _300_450 from '../../../images/temp/_300_450.jpeg'
import style from './card.module.less';


export const Li = props => {
  const {
    img_url=_300_450,
    initPosition=200,
    layout,
    transform,
    duration
  } = props;

  const img_ref = useRef(null);
  const shadow_ref = useRef(null);

  useEffect(() =>{
    [img_ref, shadow_ref].forEach(r=>{
      r.current.classList.add(style.li_animate)
    })
  },[])

  return (
  <div className={style.card}>
    <img className={style.li_img} src={img_url} ref={img_ref} />
    <div className={style.li_shadow} ref={shadow_ref} />
  </div>
  )
}
