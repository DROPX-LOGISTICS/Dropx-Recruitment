import {notFound} from 'next/navigation';
import RecruitmentApp from '../../RecruitmentApp';
import {parseRecruitRoute,recruitMenuSlugs} from '@/lib/recruitment-routes';
export default function RecruitPage({params}:{params:{workspace:string;menu:string}}) {
  if(!parseRecruitRoute(`/${params.workspace}/${params.menu}`))notFound();
  return <RecruitmentApp/>;
}

export const dynamicParams=false;
export function generateStaticParams(){return ["workforce","hr"].flatMap(workspace=>Object.values(recruitMenuSlugs).map(menu=>({workspace,menu})));}
