import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTool,statusOf,reminderCandidates,applyCompletionEvidence} from '../extension/background.js';
import {bucketOf,reconcileItems} from '../extension/planner.js';
import {inView,weeklyProgress,scopedItems} from '../extension/popup/dashboard.js';
const course={id:'12',code:'BU 111'};
test('undated class quizzes are listed without overdue status, reminders or weekly deadlines',()=>{
 const quiz=normalizeTool({QuizId:7,Name:'Practice Quiz',StartDate:'2026-09-01T00:00:00Z'},'Quiz',course);
 assert.equal(quiz.dueDate,null);assert.equal(statusOf(quiz),'Pending');assert.equal(bucketOf(quiz),'No date listed');
 assert.equal(inView(quiz,'quizzes'),true);assert.equal(inView(quiz,'upcoming'),false);
 assert.equal(weeklyProgress([quiz]).total,0);
 assert.equal(reminderCandidates({assignments:[quiz],preferences:{reminders:true},lastSync:new Date().toISOString()}).length,0);
 assert.match(quiz.link,/quiz_summary.d2l\?ou=12&qi=7/);
});
test('quiz-only view composes with class and source filters and includes completed quizzes',()=>{
 const quiz=normalizeTool({QuizId:7,DueDate:'2026-10-01T00:00:00Z'},'Quiz',course);
 const rows=[quiz,{...quiz,id:'other',courseId:'99'},{...quiz,id:'assignment',type:'Dropbox'}];
 assert.equal(scopedItems(rows,'12','d2l').filter(i=>inView(i,'quizzes')).length,1);
 assert.equal(inView({...quiz,status:'Submitted'},'quizzes'),true);
});
test('undated quiz completion can be verified and dated content reconciles to the same quiz',()=>{
 const quiz=normalizeTool({QuizId:7,Name:'Practice Quiz'},'Quiz',course);
 const complete=applyCompletionEvidence([quiz],[{OrgUnitId:12,ItemUrl:quiz.link,DateCompleted:'2026-09-27T12:00:00Z'}])[0];
 assert.equal(complete.status,'Submitted');assert.equal(bucketOf(complete),'Completed');
 const dated={...quiz,source:'content',dueDate:'2026-10-01T00:00:00Z',dateKind:'Due'};
 const merged=reconcileItems([quiz,dated]);assert.equal(merged.length,1);assert.equal(merged[0].dueDate,dated.dueDate);
});
