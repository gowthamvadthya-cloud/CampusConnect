import {requireUser,method} from './_lib/firebase.js';
export default async function handler(req,res){if(!method(req,res,['GET']))return;const u=await requireUser(req,res);if(!u)return;res.status(200).json({email:u.email,isAdmin:u.isAdmin});}
