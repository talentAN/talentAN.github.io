import RootConfig from '../../config';

const { pages } = RootConfig;

export const header = [
  { label: '关于', link: pages.home },
  { label: '博文', link: `/${pages.blog}` },
  { label: '标签', link: `/${pages.tag}` },
  { label: '联系', link: `/${pages.contact}` },
];
